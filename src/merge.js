import assert from 'power-assert'
import {Chan} from './chan'
import {arrayPool} from './pools'
import {TimeoutChan} from './special-chans'
import {CLOSED, FAILED, ERROR} from './constants'
import {P_RESOLVED_WITH_TRUE, P_RESOLVED_WITH_FALSE} from './constants'

const EMPTY = []

export class MergeChan extends Chan {

  constructor(srcs, bufferSize, closeOnFinish) {
    super(bufferSize)
    this._srcs = srcs
    this._closeOnFinish = closeOnFinish
    this._syncSrcs = arrayPool.take()
    this._inSyncRegion = false
    this._onMaybeCanSendSync_bnd = isAlive => this._onMaybeCanSendSync(isAlive)
    this._init(srcs)
    this._maybeSendNext(undefined)
  }

  _init(srcs) {
    let timeoutSrcs = EMPTY
    let dataSrcs = arrayPool.take()

    for (let i = 0; i < srcs.length; ++i) {
      let chan = srcs[i]
      if (!chan.isClosed) {
        let src = this._withHandlers({ chan,
          subscribed: false,
          onMaybeCanTakeSync: undefined,
          onClosed: undefined
        })
        if (chan instanceof TimeoutChan) {
          if (timeoutSrcs === EMPTY) timeoutSrcs = arrayPool.take()
          timeoutSrcs.push(src)
        } else {
          dataSrcs.push(src)
          chan.on('closed', src.onClosed)
        }
      }
    }

    this._timeoutSrcs = timeoutSrcs
    this._dataSrcs = dataSrcs

    this._totalTimeoutSrcs = timeoutSrcs.length
    this._totalDataSrcs = dataSrcs.length
  }

  _withHandlers(src) {
    src.onMaybeCanTakeSync = isAlive => this._onMaybeCanTakeSync(src, isAlive)
    src.onClosed = () => this._onSrcClosed(src)
    return src
  }

  _maybeSendNext(syncSrc) {
    let canSendSync = this.canSendSync
    let canTakeMore = true
    let clearSyncState = true
    this._inSyncRegion = true
    while (canSendSync && canTakeMore) {
      let syncResult; if (syncSrc) {
        syncResult = syncSrc.chan._takeSync()
        assert(syncResult !== false)
        if (syncResult === true) {
          syncResult = syncSrc.chan.value
        }
        syncSrc = undefined
      } else {
        syncResult = this._takeNextSync(clearSyncState)
        clearSyncState = false
      }
      if (syncResult === FAILED) {
        canTakeMore = false
      } else {
        if (syncResult === ERROR) {
          syncResult = this._sendSync(ERROR.value, true)
          assert(syncResult === true)
        } else {
          syncResult = this._sendSync(syncResult, false)
          assert(syncResult === true)
        }
        canSendSync = this.canSendSync
      }
    }
    this._inSyncRegion = false
    assert(canSendSync || canTakeMore)
    if (!this._totalDataSrcs && !this._totalTimeoutSrcs) {
      // no srcs left alive => end merging
      this._end()
    } else if (canTakeMore) {
      // dst can't accept more data synchronously => wait until it can, then resume
      this._maybeCanSendSync(this._onMaybeCanSendSync_bnd, false)
    } else {
      // dst can accept more data, but srcs can't provide it => wait until they can
      this._totalTimeoutSrcs && this._subscribeForSrcs(this._timeoutSrcs)
      this._totalDataSrcs && this._subscribeForSrcs(this._dataSrcs)
    }
  }

  get canTakeSync() {
    if (super.canTakeSync) {
      return true
    }
    let srcs = this._timeoutSrcs
    let totalSrcs = this._totalTimeoutSrcs
    for (let i = 0; i < totalSrcs; ++i) {
      if (srcs[i].chan.canTakeSync) {
        return true
      }
    }
    srcs = this._dataSrcs
    totalSrcs = this._totalDataSrcs
    for (let i = 0; i < totalSrcs; ++i) {
      if (srcs[i].chan.canTakeSync) {
        return true
      }
    }
    return false
  }

  _takeSync() {
    if (super._takeSync()) {
      return true
    }
    let result = this._takeNextSync(true)
    if (result === FAILED) {
      return false
    } else if (result === ERROR) {
      return result
    } else {
      this._value = result
      return true
    }
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    let result = super._maybeCanTakeSync(fn, true)
    if (result === P_RESOLVED_WITH_TRUE) {
      if (mayReturnPromise) {
        return result
      } else {
        fn(true)
        return
      }
    }
    if (result === P_RESOLVED_WITH_FALSE) {
      if (mayReturnPromise) {
        return result
      } else {
        fn(false)
        return
      }
    }
    this._totalTimeoutSrcs && this._subscribeForSrcs(this._timeoutSrcs)
    this._totalDataSrcs && this._subscribeForSrcs(this._dataSrcs)
  }

  _takeNextSync(clearState) {
    let totalTimeoutSrcs = this._totalTimeoutSrcs
    let timeoutSrcs = this._timeoutSrcs
    for (let i = 0; i < totalTimeoutSrcs; ++i) {
      let {chan} = timeoutSrcs[i]
      if (chan.canTakeSync) {
        return chan._takeSync()
      }
    }
    let syncSrcs = this._syncSrcs
    let totalSyncSrcs
    if (clearState) {
      // clearState equals true when takeNextSync is running the first time during
      // the current event loop tick
      syncSrcs.length = 0
      let dataSrcs = this._dataSrcs
      let totalDataSrcs = this._totalDataSrcs
      let i = 0; while (i < totalDataSrcs) {
        let src = dataSrcs[i]
        // otherwise, src would have been removed from the list, see onSrcClosed()
        assert(src.chan.isClosed == false)
        if (src.chan.canTakeSync) {
          syncSrcs.push(src)
        }
        ++i
      }
      totalSyncSrcs = syncSrcs.length
    } else {
      // if we're running in the same tick as previous takeNextSync call, no channel
      // that was empty in the previous call can become non-empty; but the other way
      // is certainly possible
      totalSyncSrcs = syncSrcs.length
      let i = 0; while (i < totalSyncSrcs) {
        let src = syncSrcs[i], {chan} = src
        if (chan.canTakeSync) {
          ++i
        } else {
          syncSrcs.splice(i, 1); --totalSyncSrcs
        }
      }
    }
    if (totalSyncSrcs) {
      let i = (totalSyncSrcs == 1) ? 0 : Math.floor(totalSyncSrcs * Math.random())
      let ch = syncSrcs[i].chan
      let result = ch._takeSync()
      assert(result !== false)
      return result === ERROR ? result : ch.value
    }
    return FAILED
  }

  _subscribeForSrcs(srcs) {
    for (let i = 0; i < srcs.length; ++i) {
      let src = srcs[i]
      if (!src.subscribed) {
        src.subscribed = true
        src.chan._maybeCanTakeSync(src.onMaybeCanTakeSync, false)
      }
    }
  }

  _onMaybeCanSendSync(dstAlive) {
    if (this._dataSrcs === EMPTY) {
      return // already ended
    } else if (dstAlive) {
      this._maybeSendNext(undefined)
    } else {
      this._end()
    }
  }

  _onMaybeCanTakeSync(src, srcAlive) {
    if (this._dataSrcs === EMPTY || !srcAlive) {
      return // already ended
    }
    src.subscribed = false
    this._maybeSendNext(src.chan.canTakeSync ? src : undefined)
  }

  _onSrcClosed(src) {
    assert(this._dataSrcs !== EMPTY) // otherwise this event would not be received, see end()
    src.chan.removeListener('closed', src.onClosed)
    let index = this._dataSrcs.indexOf(src)
    assert(index >= 0)
    this._dataSrcs.splice(index, 1)
    if (!--this._totalDataSrcs && !this._totalTimeoutSrcs && !this._inSyncRegion) {
      this._end()
    }
  }

  _end() {
    assert(this._dataSrcs !== EMPTY)
    let dataSrcs = this._dataSrcs
    let totalDataSrcs = this._totalDataSrcs
    for (let i = 0; i < totalDataSrcs; ++i) {
      let src = dataSrcs[i]
      src.chan.removeListener('closed', src.onClosed)
    }
    arrayPool.put(dataSrcs)
    this._dataSrcs = EMPTY
    if (this._timeoutSrcs !== EMPTY) {
      arrayPool.put(this._timeoutSrcs)
    }
    arrayPool.put(this._syncSrcs)
    this._closeOnFinish && this.close()
  }

  get _constructorName() {
    return 'chan.merge'
  }

  get _constructorArgsDesc() {
    return this._srcs
  }
}
