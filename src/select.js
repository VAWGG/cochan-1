import assert from 'power-assert'
import {CLOSED, ISCHAN, ERROR, OP_TAKE, OP_SEND} from './constants'
import {THENABLE_MIXED_USE_MSG, THENABLE_MULTIPLE_USE_MSG} from './constants'
import {TimeoutChan} from './special-chans'
import {Thenable} from './thenable'
import {arrayPool} from './pools'


export function selectSync(/* ...chans */) {
  let total = arguments.length
  let hasAliveNormalChans = false
  let syncTimeouts = arrayPool.take()
  let syncOps = arrayPool.take()

  for (let i = 0; i < total; ++i) {
    let arg = arguments[i]
    if (arg) {
      let chan, op, promise
      if (arg._ischan === ISCHAN) {
        chan = arg
        op = OP_TAKE
        promise = undefined
      } else if (arg instanceof Thenable) {
        if (arg._cancel || arg._subs) {
          throw new Error(THENABLE_MIXED_USE_MSG)
        }
        if (arg._isSealed) {
          throw new Error(THENABLE_MULTIPLE_USE_MSG)
        }
        assert(arg._op == OP_TAKE || arg._op == OP_SEND)
        assert(arg._chan && arg._chan._ischan === ISCHAN)
        promise = arg
        chan = promise._chan
        op = promise._op
        promise._seal()
      } else {
        throw new Error('select only supports passing take, send operations and channels')
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
        // cancel the pending async operation
        promise._op = 0
      }
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
      // cancel the pending async operation
      arg._op = 0
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
  let subs = arrayPool.take()
  let numClosed = 0

  for (let i = 0; i < arguments.length; ++i) {
    let arg = arguments[i]
    if (arg) {
      if (arg._ischan === ISCHAN) {
        if (!arg.isClosed) {
          subs.push({
            promise: undefined,
            unsub: arg._take(makeOnValue(arg, onValue), onTakeError, true)
          })
        }
      } else if (!arg._chan.isClosed) {
        assert(arg instanceof Thenable)
        arg._addSub(arg._op == OP_SEND
          ? makeThenableSub(arg._chan, onValue, onSendError)
          : { onFulfilled: makeOnValue(arg._chan, onValue),
              onRejected: onTakeError
          })
        subs.push({ promise: arg, unsub: undefined })
      }
    }
  }

  // this is handled by selectSync
  assert(subs.length > 0)
  return promise

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
        promise._op = 0
      }
    }
    arrayPool.put(subs)
  }
}

function makeOnValue(chan, onValue) {
  return v => onValue(v, chan)
}

function makeThenableSub(chan, onValue, onError) {
  return {
    onFulfilled: v => onValue(v, chan),
    onRejected: e => onError(e, chan)
  }
}
