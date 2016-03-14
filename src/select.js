import assert from 'power-assert'
import {CLOSED, ERROR} from './constants'
import {TimeoutChan} from './special-chans'

export function selectSync(/* ...chans */) {
  let hasAliveDataChans = false
  let chansWithData = []
  let timeoutChan = undefined
  
  for (let i = 0; i < arguments.length; ++i) {
    let chan = arguments[i]
    if (chan.canTakeSync) {
      if (chan instanceof TimeoutChan) {
        timeoutChan = chan
      } else {
        hasAliveDataChans = true
        chansWithData.push(chan)
      }
    } else if (!(chan.isClosed || chan instanceof TimeoutChan)) {
      hasAliveDataChans = true
    }
  }

  if (timeoutChan && hasAliveDataChans) {
    timeoutChan.takeSync() // will throw
    assert.ok(false, 'timeout chan should have thrown but did not')
  }

  let totalChans = chansWithData.length
  if (totalChans == 0) {
    return hasAliveDataChans ? null : CLOSED
  }

  assert(timeoutChan === undefined)

  let chan = chansWithData[ totalChans == 1 ? 0 : Math.floor(Math.random() * totalChans) ]
  if (!chan.takeSync()) {
    assert.ok(false, 'chan should have allowed to take synchronously, but did not')
  }

  return chan
}


function trySelectSync(/* ...chans */) {
  try {
    return selectSync.apply(null, arguments)
  } catch (err) {
    ERROR.value = err
    return ERROR
  }
}


export function select(/* ...chans */) {
  let syncResult = trySelectSync.apply(null, arguments)
  if (syncResult === ERROR) {
    return Promise.reject(ERROR.value)
  }

  if (syncResult) {
    return Promise.resolve(syncResult)
  }

  let fnVal, fnErr
  let promise = new Promise((res, rej) => { fnVal = res; fnErr = rej })
  let cancelFns = []
  let numClosed = 0

  for (let i = 0; i < arguments.length; ++i) {
    let chan = arguments[i]
    if (!chan.isClosed) {
      cancelFns.push(chan._take(v => onValue(v, chan), onError, true))
    }
  }

  function onValue(value, chan) {
    if (value === CLOSED) {
      if (++numClosed < cancelFns.length) {
        return
      } else {
        chan = CLOSED
      }
    }
    unsub()
    fnVal(chan)
  }

  // TODO: should we really propagate the first encountered error
  // to the caller, even if there are other non-closed channels?
  function onError(err) {
    unsub()
    fnErr(err)
  }

  function unsub() {
    assert(cancelFns.length > 0)
    for (let i = 0; i < cancelFns.length; ++i) {
      cancelFns[i]()
    }
  }

  return promise
}
