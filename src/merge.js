import assert from 'power-assert'
import {TimeoutChan} from './special-chans'
import {CLOSED, FAILED, ERROR} from './constants'

const EMPTY = []


export function mergeTo(dst, srcs, closeDst) {
  let timeoutSrcs = EMPTY
  let dataSrcs = []

  for (let i = 0; i < srcs.length; ++i) {
    let src, chan = srcs[i]
    if (chan instanceof TimeoutChan) {
      src = {chan, unsub: undefined,
        onValue: undefined,
        onError: e => onData(e, true, src)
      }
      if (timeoutSrcs === EMPTY) {
        timeoutSrcs = [src]
      } else {
        timeoutSrcs.push(src)
      }
    } else if (!chan.isClosed) {
      dataSrcs.push(src = {chan, unsub: undefined,
        onValue: v => onValue(v, src),
        onError: e => onData(e, true, src)
      })
    }
  }

  let syncSrcs = []
  let unsubFns = []
  let totalDataSrcs = dataSrcs.length

  takeNext()
  return dst

  function takeNext() {
    let syncResult = takeNextSync(true)
    if (syncResult !== FAILED) {
      if (syncResult === ERROR) {
        onData(ERROR.value, true, null)
      } else {
        onData(syncResult, false, null)
      }
    } else {
      subscribeForNext()
    }
  }

  function takeNextSync(clearState) {
    for (let i = 0; i < timeoutSrcs.length; ++i) {
      let {chan} = timeoutSrcs[i]
      if (chan.canTakeSync) {
        return tryTakeSyncFrom(chan)
      }
    }
    if (clearState) {
      // clearState equals true when takeNextSync is running the first time during
      // the current event loop tick
      syncSrcs.length = 0
      let i = 0; while (i < dataSrcs.length) {
        let src = dataSrcs[i], {chan} = src
        if (chan.isClosed) {
          dataSrcs.splice(i, 1)
        } else {
          if (chan.canTakeSync) {
            syncSrcs.push(src)
          }
          ++i
        }
      }
    } else {
      // if we're running in the same tick as previous takeNextSync call, no channel
      // that was empty in the previous call can become non-empty; but the other way
      // is certainly possible
      let i = 0; while (i < syncSrcs.length) {
        let src = syncSrcs[i], {chan} = src
        if (chan.canTakeSync) {
          ++i
        } else {
          syncSrcs.splice(i, 1)
          if (chan.isClosed) {
            let index = dataSrcs.indexOf(src)
            assert(index >= 0)
            dataSrcs.splice(index, 1)
          }
        }
      }
    }
    let totalSyncSrcs = syncSrcs.length
    if (totalSyncSrcs) {
      let i = (totalSyncSrcs == 1) ? 0 : Math.floor(totalSyncSrcs * Math.random())
      return tryTakeSyncFrom(syncSrcs[i].chan)
    }
    return FAILED
  }

  function subscribeForNext() {
    assert(unsubFns.length == 0)
    totalDataSrcs = dataSrcs.length
    if (totalDataSrcs == 0) {
      return end()
    }
    for (let i = 0; i < timeoutSrcs.length; ++i) {
      let src = timeoutSrcs[i]
      unsubFns.push(src.unsub = src.chan._take(undefined, src.onError, true))
    }
    for (let i = 0; i < totalDataSrcs; ++i) {
      let src = dataSrcs[i]
      unsubFns.push(src.unsub = src.chan._take(src.onValue, src.onError, true))
    }
  }

  function onValue(value, src) {
    if (value !== CLOSED) {
      return onData(value, false, src)
    }
    if (!--totalDataSrcs) {
      end()
    }
  }

  function onData(value, isError, src) {
    let clearSyncState = !!src
    let hasNextValue = true
    let canSendSync = dst.canSendSync
    while (hasNextValue && canSendSync) {
      dst.sendSync(value, isError)
      let syncResult = takeNextSync(clearSyncState)
      if (syncResult !== FAILED) {
        if (syncResult === ERROR) {
          value = ERROR.value
          isError = true
        } else {
          value = syncResult
          isError = false
        }        
        canSendSync = dst.canSendSync
        clearSyncState = false
      } else {
        hasNextValue = false
      }
    }
    assert(hasNextValue || canSendSync)
    if (hasNextValue) {
      // dst can't take that much data synchronously => unsub from srcs and enqueue taken value
      unsubAll()
      dst._send(value, isError, takeNext, onSendError, false)
    // dst can take more data synchronously, but srcs cannot provide it yet
    } else if (src) {
      // value came asynchronously from an src => resubscribe to that src
      let index = unsubFns.indexOf(src.unsub)
      assert(index >= 0)
      unsubFns.splice(index, 1, src.unsub = src.chan._take(src.onValue, src.onError, true))
    } else if (!unsubFns.length) {
      // value came synchronously from an src, no subscriptions => subscribe to all srcs
      subscribeForNext()
    }
  }

  function onSendError(err) {
    end()
  }

  function end() {
    unsubAll()
    if (closeDst) {
      dst.close()
    }
  }

  function unsubAll() {
    for (let i = 0; i < unsubFns.length; ++i) {
      unsubFns[i]()
    }
    unsubFns.length = 0
  }
}


function tryTakeSyncFrom(chan) {
  assert(chan.canTakeSync)
  try {
    chan.takeSync()
    return chan.value
  } catch (err) {
    ERROR.value = err
    return ERROR
  }
}
