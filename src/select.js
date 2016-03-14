import assert from 'power-assert'
import {CLOSED, ISCHAN, ERROR, OP_TAKE, OP_SEND, THENABLE_INVALID_USE_MSG} from './constants'
import {TimeoutChan} from './special-chans'
import {Thenable} from './thenable'
import {arrayPool, thenablePool} from './pools'


export function selectSync(/* ...chans */) {
  let total = arguments.length
  let hasAliveNormalChans = false
  let syncTimeouts = arrayPool.take()
  let syncOps = arrayPool.take()

  for (let i = 0; i < total; ++i) {
    let arg = arguments[i]
    if (!arg) {
      throw new Error('select expects a list of operations or channels, got: ' + arg)
    }
    let chan, op, promise
    if (arg._ischan === ISCHAN) {
      chan = arg
      op = OP_TAKE
      promise = undefined
    } else if (arg instanceof Thenable) {
      if (arg._cancel || arg._subs) {
        throw new Error(THENABLE_INVALID_USE_MSG)
      }
      promise = arg
      chan = promise._chan
      op = promise._op
      promise._seal()
    } else {
      throw new Error('select only supports take and send operations')
    }
    if (chan instanceof TimeoutChan) {
      if (chan.canTakeSync) {
        syncTimeouts.push(chan)
      }
    } else if (op == OP_TAKE ? chan.canTakeSync : chan.canSendSync) {
      syncOps.push({ chan, promise, kind: op })
      hasAliveNormalChans = true
    } else if (!chan.isClosed) {
      hasAliveNormalChans = true
    } else if (promise) {
      // cancel the pending async operation and return thenable into the pool
      thenablePool.put(promise)
    }
  }

  total = syncTimeouts.length
  if (total && hasAliveNormalChans) {
    let chan = random(syncTimeouts, total)
    arrayPool.put(syncTimeouts)
    arrayPool.put(syncOps)
    chan.takeSync() // will throw
    assert.ok(false, 'timeout chan should have thrown but did not')
  }

  total = syncOps.length
  if (total == 0) {
    arrayPool.put(syncTimeouts)
    arrayPool.put(syncOps)
    return hasAliveNormalChans ? null : CLOSED
  }

  assert(syncTimeouts.length == 0)
  arrayPool.put(syncTimeouts)

  let op = random(syncOps, total)
  arrayPool.put(syncOps)

  let {chan} = op

  assert(op.kind == OP_TAKE || op.kind == OP_SEND)
  assert(chan != undefined)

  if (op.kind == OP_TAKE) {
    if (!chan.takeSync()) {
      assert.ok(false, 'chan should have allowed to take synchronously, but did not')
    }
  } else {
    assert(op.kind == OP_SEND)
    assert(op.promise != undefined)
    assert(op.promise._sendData != undefined)
    let data = op.promise._sendData
    if (!chan.sendSync(data.value, data.isError)) {
      assert.ok(false, 'chan should have allowed to send synchronously, but did not')
    }
  }

  total = arguments.length
  for (let i = 0; i < total; ++i) {
    let arg = arguments[i]
    if (arg instanceof Thenable) {
      // cancel the pending async operation and return thenable into the pool
      thenablePool.put(arg)
    }
  }

  return chan
}


function random(arr, len) {
  return arr[ len == 1 ? 0 : Math.floor(Math.random() * len) ]
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
  let subs = []
  let numClosed = 0

  for (let i = 0; i < arguments.length; ++i) {
    let arg = arguments[i]
    if (arg._ischan === ISCHAN) {
      if (!arg.isClosed) {
        subs.push({
          promise: undefined,
          unsub: arg._take(v => onValue(v, arg), onTakeError, true)
        })
      }
    } else if (!arg._chan.isClosed) {
      assert(arg instanceof Thenable)
      arg._addSub({
        onFulfilled: v => onValue(v, arg._chan),
        onRejected: e => onSendError(e, arg._chan)
      })
      subs.push({ promise: arg, unsub: undefined })
    }
  }

  function onValue(value, chan) {
    if (value === CLOSED) {
      if (++numClosed < subs.length) {
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

  function onSendError(err, chan) {
    if (!chan.isActive) {
      if (++numClosed >= subs.length) {
        unsub()
        fnVal(CLOSED)
      }
    } else {
      unsub()
      fnErr(err)
    }
  }

  function onTakeError(err) {
    unsub()
    fnErr(err)
  }

  function unsub() {
    assert(subs.length > 0)
    for (let i = 0, n = subs.length; i < n; ++i) {
      let sub = subs[i]
      if (sub.unsub) {
        sub.unsub()
      } else {
        assert(sub.promise != undefined)
        let {promise} = sub
        // promise._cancel may be undefined here because _send/_take might have called
        // its handler (i.e. us) synchronously, so _send/_take call, that returns the
        // cancel function which later gets assigned to promise._cancel, might have
        // not returned yet
        promise._cancel && promise._cancel()
        // return thenable into the pool
        thenablePool.put(promise)
      }
    }
  }

  return promise
}
