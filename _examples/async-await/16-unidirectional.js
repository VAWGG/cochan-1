import chan from '../../src'
import {p, sleep, getOneLinerBody} from '../utils'

async function produceInto(sendOnly) {
  p()
  p(`sendOnly.canTake:`, sendOnly.canTake)
  p(`sendOnly.canSend:`, sendOnly.canSend)
  //
  // prohibited for send-only chan, will throw
  //
  await attempt(_ => sendOnly.take(), '\n')
  await attempt(_ => sendOnly.takeSync())
  await attempt(_ => sendOnly.takeOnly)
  //
  // allowed for send-only chan
  //
  await attempt(_ => sendOnly.send(123), '\n')
  await attempt(_ => sendOnly.sendSync(456))
  await attempt(_ => sendOnly.sendOnly)
  async function close() {
    await sleep(100)
    await attempt(_ => sendOnly.close(), '\n')
    await attempt(_ => sendOnly.closeSync())
    await attempt(_ => sendOnly.closeNow())
  }
  // close asynchronously to avoid deadlock
  close().catch(p)
}

async function consumeFrom(takeOnly) {
  p()
  p(`takeOnly.canTake:`, takeOnly.canTake)
  p(`takeOnly.canSend:`, takeOnly.canSend)
  //
  // prohibited for take-only chan, will throw
  //
  await attempt(_ => takeOnly.send(123), '\n')
  await attempt(_ => takeOnly.sendSync(456))
  await attempt(_ => takeOnly.close())
  await attempt(_ => takeOnly.closeSync())
  await attempt(_ => takeOnly.closeNow())
  await attempt(_ => takeOnly.sendOnly)
  //
  // allowed for take-only chan
  //
  await attempt(_ => takeOnly.take(), '\n')
  await attempt(_ => takeOnly.takeSync())
  await attempt(_ => takeOnly.takeOnly)
}

async function run() {
  let ch = chan(2)
  await produceInto(ch.sendOnly)
  await consumeFrom(ch.takeOnly)
}

async function attempt(fn, prependDesc = '') {
  let desc = prependDesc + getOneLinerBody(fn)
  try {
    let result = fn()
    if (result && 'function' == typeof result.then) {
      try {
        result = await result
      } catch (err) {
        p(`${desc} failed asynchronously: ${err}`)
        return
      }
      p(`${desc} succeeded asynchronously, result: ${result}`)
    } else {
      p(`${desc}: ${result}`)
    }
  } catch (err) {
    p(`${desc} thrown ${err}`)
  }
}

run().catch(p)
