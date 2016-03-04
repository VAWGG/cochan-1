import {CLOSED, FAILED} from './constants'
import {TimeoutChan} from './special-chans'


function trySelectNoThrow(/* chans */) {
  try {
    let value = trySelect.apply(null, arguments)
    return { value, thrown: false }
  } catch (err) {
    return { value: err, thrown: true }
  }
}


export function trySelect(chans) {
  if (arguments.length > 1) {
    chans = arguments
  }

  let hasAliveDataChans = false
  let chansWithData = []
  let timeoutChan = undefined
  
  for (let i = 0; i < chans.length; ++i) {
    let chan = chans[i]
    if (chan.canTakeSync) {
      if (chan instanceof TimeoutChan) {
        timeoutChan = chan
      } else {
        chansWithData.push(chan)
      }
    } else if (!(chan.isClosed || chan instanceof TimeoutChan)) {
      hasAliveDataChans = true
    }
  }

  if (!chansWithData.length) {
    if (!hasAliveDataChans) {
      return { chan: CLOSED, value: CLOSED }
    }
    if (timeoutChan) {
      return timeoutChan.tryTake() // will throw
    }
    return { chan: FAILED, value: FAILED }
  }

  let totalChans = chansWithData.length
  let chan = chansWithData[ totalChans == 1 ? 0 : Math.floor(Math.random() * totalChans) ]

  return { chan, value: chan.tryTake() }
}


export function select(chans) {
  let syncResult = trySelectNoThrow.apply(null, arguments)
  if (syncResult.thrown) {
    return Promise.reject(syncResult.value)
  }
  if (syncResult.value.value !== FAILED) {
    return Promise.resolve(syncResult.value)
  }

  if (arguments.length > 1) {
    chans = arguments
  }

  let fnVal, fnErr
  let promise = new Promise((res, rej) => { fnVal = res; fnErr = rej })
  let cancelFns = []
  let numClosed = 0

  for (let i = 0; i < chans.length; ++i) {
    let chan = chans[i]
    if (!chan.isClosed) {
      cancelFns.push(chan._take(v => onValue(v, chan), onError, true))
    }
  }

  function onValue(value, chan) {
    if (value === CLOSED) {
      if (++numClosed < cancelFns.length) {
        return
      }
      chan = CLOSED
    }
    unsub()
    fnVal({ chan, value })
  }

  function onError(err) {
    unsub()
    fnErr(err)
  }

  function unsub() {
    for (let i = 0; i < cancelFns.length; ++i) {
      cancelFns[i]()
    }
  }

  return promise
}
