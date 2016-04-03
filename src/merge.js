import assert from 'power-assert'
import {Chan} from './chan'
import {arrayPool} from './pools'
import {TimeoutChan} from './special-chans'
import {CLOSED, FAILED, ERROR} from './constants'
import {SEND_TYPE_VALUE, SEND_TYPE_ERROR} from './constants'
import {P_RESOLVED_WITH_TRUE, P_RESOLVED_WITH_FALSE} from './constants'
import {EventEmitterMixin} from './event-emitter'


const CANNOT_SEND_ERROR_MSG = `Sending and piping into a merge channel is not supported. ` +
  `As a workaround, you can add one more channel into the merged set, and send/pipe into it.`

const EMPTY = []

const STATE_AWAITING_SEND = 0
const STATE_ENQUEUEING_TAKES = 1
const STATE_AWAITING_TAKE = 2
const STATE_MERGING_SYNC = 3
const STATE_ENDED = 4

const STATE_NAMES = [
  'STATE_AWAITING_SEND', 'STATE_ENQUEUEING_TAKES', 'STATE_AWAITING_TAKE',
  'STATE_MERGING_SYNC', 'STATE_ENDED'
]


export class MergeChan extends Chan {

  constructor(srcs, bufferSize, closeOnFinish) {
    super(bufferSize)
    this._srcs = srcs
    this._closeOnFinish = closeOnFinish
    this._mergeState = STATE_AWAITING_SEND
    this._syncSrcs = arrayPool.take()
    this._init(srcs)
    this._maybeSendNext()
  }

  _init(srcs) {
    this.on('drain', () => this._maybeSendNext())

    let timeoutSrcs = EMPTY
    let dataSrcs = arrayPool.take()

    for (let i = 0; i < srcs.length; ++i) {
      let chan = srcs[i]
      if (!chan.isClosed) {
        let isTimeout = chan instanceof TimeoutChan
        let src = this._makeSrc(chan, isTimeout)
        if (isTimeout) {
          if (timeoutSrcs === EMPTY) timeoutSrcs = arrayPool.take()
          timeoutSrcs.push(src)
        } else {
          dataSrcs.push(src)
        }
      }
    }

    this._timeoutSrcs = timeoutSrcs
    this._dataSrcs = dataSrcs

    this._totalTimeoutSrcs = timeoutSrcs.length
    this._totalDataSrcs = dataSrcs.length
  }

  _makeSrc(chan, isTimeout) {
    let src = { chan, cancel: undefined, onClosed: undefined,
      onTakenValue: undefined, onTakenError: undefined }
    if (isTimeout) {
      src.onTakenValue = onTakenValueFromTimeoutChan
    } else {
      src.onTakenValue = value => this._onTaken(value, SEND_TYPE_VALUE, src)
      src.onClosed = () => this._onSrcClosed(src)
      src.chan.on('closed', src.onClosed)
    }
    src.onTakenError = error => this._onTaken(error, SEND_TYPE_ERROR, src)
    return src
  }

  _maybeSendNext() {
    assert(this._mergeState == STATE_AWAITING_SEND || this._mergeState == STATE_AWAITING_TAKE)
    let canSendSync = this._super$canSendSync
    let canTakeMore = true
    let clearSyncState = true
    this._mergeState = STATE_MERGING_SYNC
    while (canSendSync && canTakeMore) {
      let syncResult = this._takeNextSync(clearSyncState)
      clearSyncState = false
      if (syncResult === FAILED) {
        canTakeMore = false
      } else {
        if (syncResult === ERROR) {
          syncResult = this._super$_sendSync(ERROR.value, true)
          assert(syncResult === true)
        } else {
          syncResult = this._super$_sendSync(syncResult, false)
          assert(syncResult === true)
        }
        canSendSync = this._super$canSendSync
      }
    }
    assert(canSendSync || canTakeMore)
    if (!this._totalDataSrcs && !this._totalTimeoutSrcs) {
      // no srcs left alive => end merging
      this._end()
    } else if (!canSendSync) {
      // dst can't accept more data synchronously => wait until it can, then resume
      this._mergeState = STATE_AWAITING_SEND
      this.setNeedsDrain()
      this._cancelTakes()
    } else {
      assert(canTakeMore == false && this._canTakeNextSync() == false)
      this._mergeState = STATE_AWAITING_TAKE
      // srcs can't provide more data => wait until they can
      this._enqueueTakesFrom(this._timeoutSrcs, this._totalTimeoutSrcs)
      this._enqueueTakesFrom(this._dataSrcs, this._totalDataSrcs)
    }
  }

  get canTakeSync() {
    return super.canTakeSync || this._canTakeNextSync()
  }

  _canTakeNextSync() {
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

  _enqueueTakesFrom(srcs, total) {
    assert(this._mergeState == STATE_AWAITING_TAKE)
    if (total == 0) return
    this._mergeState = STATE_ENQUEUEING_TAKES
    for (let i = 0; i < total; ++i) {
      let src = srcs[i]
      if (!src.cancel) {
        src.cancel = src.chan._take(src.onTakenValue, src.onTakenError, true)
      }
    }
    this._mergeState = STATE_AWAITING_TAKE
  }

  _cancelTakes() {
    this._cancelTakesFrom(this._timeoutSrcs, this._totalTimeoutSrcs)
    this._cancelTakesFrom(this._dataSrcs, this._totalDataSrcs)
  }

  _cancelTakesFrom(srcs, total) {
    for (let i = 0; i < total; ++i) {
      let src = srcs[i]
      if (src.cancel) {
        src.cancel()
        src.cancel = undefined
      }
    }
  }

  _onTaken(value, type, src) {
    assert(this._mergeState == STATE_AWAITING_TAKE, onTakenInvalidStateMsg(this._mergeState, src))
    src.cancel = undefined
    if (value == CLOSED) return
    let sent = this._super$_sendSync(value, type)
    assert(sent == true)
    this._maybeSendNext()
  }

  _onSrcClosed(src) {
    // otherwise this event would have not been received, see end()
    assert(this._mergeState != STATE_ENDED)
    src.chan.removeListener('closed', src.onClosed)
    let index = this._dataSrcs.indexOf(src)
    assert(index >= 0)
    this._dataSrcs.splice(index, 1)
    if (!--this._totalDataSrcs && !this._totalTimeoutSrcs && this._mergeState != STATE_MERGING_SYNC) {
      this._end()
    }
  }

  _end() {
    assert(this._mergeState != STATE_ENDED)
    this._mergeState = STATE_ENDED
    freeSrcs(this._dataSrcs, this._totalDataSrcs)
    let totalTimeoutSrcs = this._totalTimeoutSrcs
    if (totalTimeoutSrcs) {
      assert(this._timeoutSrcs !== EMPTY)
      freeSrcs(this._timeoutSrcs, totalTimeoutSrcs)
    }
    arrayPool.put(this._syncSrcs)
    if (this._closeOnFinish) {
      this.close()
    }
  }

  _cancelTake(item) {
    let buf = this._buffer
    let index = buf.indexOf(item)
    if (index == -1) return
    buf.splice(index, 1)
    if (buf.length == 0) {
      this._cancelTakes()
    }
  }

  get _constructorName() {
    return 'chan.merge'
  }

  get _constructorArgsDesc() {
    return this._srcs
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    if (this.canTakeSync) {
      return mayReturnPromise ? P_RESOLVED_WITH_TRUE : (fn(true), undefined)
    }
    if (this._mergeState == STATE_ENDED) {
      return mayReturnPromise ? P_RESOLVED_WITH_FALSE : (fn(false), undefined)
    }
    fn = callOnce1(fn)
    let srcs = this._dataSrcs
    for (let i = 0; i < srcs.length; ++i) {
      srcs[i].chan._maybeCanTakeSync(fn, false)
    }
    super._maybeCanTakeSync(fn, false)
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  _maybeCanSendSync(fn, mayReturnPromise) {
    if (mayReturnPromise) {
      return this.isActive ? P_RESOLVED_WITH_TRUE : P_RESOLVED_WITH_FALSE
    } else {
      fn(this.isActive)
    }
  }

  send(value, type) {
    this._throwSendingNotSupported()
  }

  _sendSync(value, type) {
    this._throwSendingNotSupported()
  }

  _send(value, type, fnVal, fnErr, needsCancelFn) {
    this._throwSendingNotSupported()
  }

  emit(event/* ...args */) {
    if (event == 'pipe') {
      this._throwSendingNotSupported()
    }
    this._super$emit.apply(this, arguments)
  }

  _throwSendingNotSupported() {
    throw new Error(CANNOT_SEND_ERROR_MSG)
  }
}

function freeSrcs(srcs, total) {
  for (let i = 0; i < total; ++i) {
    let src = srcs[i]
    if (src.onClosed) {
      src.chan.removeListener('closed', src.onClosed)
    }
    if (src.cancel) {
      src.cancel()
    }
  }
  arrayPool.put(srcs)
}

function onTakenValueFromTimeoutChan(value) {
  assert(false, `taken value ${value} from a timeout chan`)
}

function onTakenInvalidStateMsg(state, src) {
  return state == STATE_ENQUEUEING_TAKES
    ? `one of the source channels, ${src.chan}, called its _take callback synchronously ` +
      `despite the fact that it reported that it cannot be synchronously taken from`
    : `internal inconsistency error`
}

function callOnce1(fn) {
  let doCall = true; return arg => {
    if (doCall) {
      doCall = false
      fn(arg)
    }
  }
}

Object.defineProperties(MergeChan.prototype, {
  _super$emit: {
    value: EventEmitterMixin.emit,
    writable: true,
    enumerable: false,
    configurable: true
  },
  _super$_sendSync: {
    value: Chan.prototype._sendSync,
    writable: true,
    enumerable: false,
    configurable: true
  },
  _super$canSendSync: Object.getOwnPropertyDescriptor(Chan.prototype, 'canSendSync')
})
