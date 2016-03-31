import assert from 'power-assert'
import {arrayPool} from './pools'
import {TimeoutChan} from './special-chans'
import {CLOSED, FAILED, ERROR} from './constants'

const EMPTY = []


// TODO: create custom chan that knows how to calculate canTakeSync,
//       takeSync() and propagate maybeCanTakeSync() to srcs


export function mergeTo(dst, srcs, closeDst) {
  let timeoutSrcs = EMPTY
  let dataSrcs = arrayPool.take()

  for (let i = 0; i < srcs.length; ++i) {
    let chan = srcs[i]
    if (!chan.isClosed) {
      let src = withHandlers(onMaybeCanTakeSync, onClosed, { chan,
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

  let syncSrcs = arrayPool.take()
  let totalDataSrcs = dataSrcs.length
  let totalTimeoutSrcs = timeoutSrcs.length

  maybeSendNext(undefined)
  return dst

  function takeNextSync(clearState) {
    for (let i = 0; i < totalTimeoutSrcs; ++i) {
      let {chan} = timeoutSrcs[i]
      if (chan.canTakeSync) {
        return chan._takeSync()
      }
    }
    let totalSyncSrcs
    if (clearState) {
      // clearState equals true when takeNextSync is running the first time during
      // the current event loop tick
      syncSrcs.length = 0
      let i = 0; while (i < totalDataSrcs) {
        let src = dataSrcs[i], {chan} = src
        if (chan.isClosed) {
          dataSrcs.splice(i, 1)
          --totalDataSrcs
        } else {
          if (chan.canTakeSync) {
            syncSrcs.push(src)
          }
          ++i
        }
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
          if (chan.isClosed) {
            let index = dataSrcs.indexOf(src)
            assert(index >= 0)
            dataSrcs.splice(index, 1); --totalDataSrcs
          }
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

  function maybeSendNext(syncSrc) {
    let canSendSync = dst.canSendSync
    let canTakeMore = true
    let clearSyncState = true
    while (canSendSync && canTakeMore) {
      let syncResult; if (syncSrc) {
        syncResult = syncSrc.chan._takeSync()
        assert(syncResult !== false)
        if (syncResult === true) {
          syncResult = syncSrc.chan.value
        }
        syncSrc = undefined
      } else {
        syncResult = takeNextSync(clearSyncState)
        clearSyncState = false
      }
      if (syncResult === FAILED) {
        canTakeMore = false
      } else {
        if (syncResult === ERROR) {
          syncResult = dst._sendSync(ERROR.value, true)
          assert(syncResult === true)
        } else {
          syncResult = dst._sendSync(syncResult, false)
          assert(syncResult === true)
        }
        canSendSync = dst.canSendSync
      }
    }
    assert(canSendSync || canTakeMore)
    if (!totalDataSrcs) {
      // no srcs left alive => end merging
      end()
    } else if (canTakeMore) {
      // dst can't accept more data synchronously => wait until it can, then resume
      dst._maybeCanSendSync(onMaybeCanSendSync, false)
    } else {
      // dst can accept more data, but srcs can't provide it => wait until they can
      totalTimeoutSrcs && subscribeForSrcs(timeoutSrcs)
      totalDataSrcs && subscribeForSrcs(dataSrcs)
    }
  }

  function onMaybeCanSendSync(dstAlive) {
    if (dataSrcs === EMPTY) {
      return // already ended
    } else if (dstAlive) {
      maybeSendNext(undefined)
    } else {
      end()
    }
  }

  function onMaybeCanTakeSync(src, srcAlive) {
    if (dataSrcs === EMPTY || !srcAlive) {
      return // already ended
    }
    src.subscribed = false
    maybeSendNext(src.chan.canTakeSync ? src : undefined)
  }

  function onClosed(src) {
    if (dataSrcs === EMPTY) {
      return // already ended
    }
    src.chan.removeListener('closed', src.onClosed)
    let index = dataSrcs.indexOf(src)
    assert(index >= 0)
    dataSrcs.splice(index, 1)
    if (!--totalDataSrcs) end()
  }

  function end() {
    assert(dataSrcs !== EMPTY)
    for (let i = 0; i < totalDataSrcs; ++i) {
      let src = dataSrcs[i]
      src.chan.removeListener('closed', src.onClosed)
    }
    arrayPool.put(dataSrcs)
    dataSrcs = EMPTY
    if (timeoutSrcs !== EMPTY) {
      arrayPool.put(timeoutSrcs)
    }
    arrayPool.put(syncSrcs)
    closeDst && dst.close()
  }
}

function subscribeForSrcs(srcs) {
  for (let i = 0; i < srcs.length; ++i) {
    let src = srcs[i]
    if (!src.subscribed) {
      src.subscribed = true
      src.chan._maybeCanTakeSync(src.onMaybeCanTakeSync, false)
    }
  }
}

function withHandlers(onMaybeCanTakeSync, onClosed, src) {
  src.onMaybeCanTakeSync = isClosed => onMaybeCanTakeSync(src, isClosed)
  src.onClosed = () => onClosed(src)
  return src
}

function makeOnMaybeCanTakeSync(src, onMaybeCanTakeSync) {
  return isClosed => onMaybeCanTakeSync(src, isClosed)
}

function onError(err) {
  setTimeout(() => { throw err }, 0)
}
