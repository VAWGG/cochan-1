import assert from 'power-assert'
import {isThenable} from './utils'


export function thenableRunner(runnable, type) {
  return runnable
}


thenableRunner.getRunnableType = function thenableRunner$getRunnableType(obj) {
  return isThenable(obj) ? 1 : null
}


export function fromIterator(iter, chan, closeChan, sendRetval, { runner, getRunnableType }) {
  let done = false
  next(undefined, false)
  return chan

  function next(valueToSend, valueToSendIsError) {
    if (!chan.isActive) {
      return end()
    }
    if (done) {
      if ((sendRetval || valueToSendIsError) && !chan.sendSync(valueToSend, valueToSendIsError)) {
        chan._send(valueToSend, valueToSendIsError, undefined, sendToActiveChanFailed, false)
      }
      return end()
    }
    let state
    let hasNextValue = true
    let valueIsResolved = true
    let canSendSync = true
    do {
      state = tryNext(iter, valueToSend, valueToSendIsError)
      hasNextValue = !state.done
      valueToSend = undefined
      valueToSendIsError = false
      if (runner && !state.isError) {
        let runnableType = getRunnableType(state.value)
        if (runnableType != null) {
          do {
            let ret = tryRun(runner, state.value, runnableType)
            if (!ret.isError && isThenable(ret.value)) {
              valueIsResolved = false
              state = ret
            } else if (hasNextValue) {
              state = tryNext(iter, ret.value, ret.isError)
              hasNextValue = !state.done
              runnableType = state.isError ? null : getRunnableType(state.value)
            } else {
              state = { value: ret.value, done: true, isError: ret.isError }
            }
          } while (hasNextValue && valueIsResolved && runnableType != null)
        }
      }
      if (valueIsResolved) {
        if (sendRetval || hasNextValue || state.isError) {
          canSendSync = chan.canSendSync
          if (canSendSync) {
            chan.sendSync(state.value, state.isError)
          }
        }
      }
    } while (valueIsResolved && canSendSync && hasNextValue)

    done = !hasNextValue

    if (canSendSync) {
      if (valueIsResolved) {
        assert(hasNextValue == false)
        // iter has ended, the last value is already sent to the chan
        end()
      } else {
        assert(state.isError == false)
        // we need to wait until the runner resolves the value from iter, 
        // and then either pass the resolved value back to the iter, when
        // hasNextValue == true, or send it to the channel and end
        // otherwise; the next next() call will do exactly this
        state.value.then(onResolvedValue, onResolvedError)
      }
    } else {
      assert(valueIsResolved == true)
      // we've got value from iter, but chan cannot accept it yet
      if (hasNextValue) {
        // iter has not ended yet => enqueue the value into the chan, and
        // resume iteration after it's accepted
        chan._send(state.value, state.isError, onValueSent, sendToActiveChanFailed, false)
      } else {
        // iter has ended, so we just need to send its last value (if iter is
        // generator), and end the whole thing; we don't need to wait until
        // the value is accepted, because even if end() calls chan.close(), 
        // the latter will do this waiting for us
        if (sendRetval || state.isError) {
          chan._send(state.value, state.isError, undefined, sendToActiveChanFailed, false)
        }
        end()
      }
    }

    function onValueSent() {
      next(undefined, false)
    }

    function end() {
      iter = undefined
      if (closeChan) {
        chan.close()
      }
    }
  }

  function onResolvedValue(value) {
    next(value, false)
  }

  function onResolvedError(err) {
    next(err, true)
  }
}


function tryNext(iter, value, isError) {
  try {
    let ret; if (isError) {
      if (iter.throw) {
        ret = iter.throw(value)
      } else {
        return { value, done: true, isError: true }
      }
    } else {
      ret = iter.next(value)
    }
    ret.isError = false
    return ret
  } catch (err) {
    return { value: err, done: true, isError: true }
  }
}


function tryRun(runner, runnable, runnableType) {
  try {
    let value = runner(runnable, runnableType)
    return { value, isError: false }
  } catch (err) {
    return { value: err, isError: true }
  }
}


function sendToActiveChanFailed(err) {
  assert(err === 'what?', 'this should not happen')
}
