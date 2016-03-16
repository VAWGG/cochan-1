import chan from '../../src'
import {p, sleep} from '../utils'

//
// chan.delay(ms[, value])
//

async function runDelay() {
  let ch = chan.delay(1000, 'delayed value')
  await consume(ch)
}

//
// chan.fromPromise(p)
//

async function runPromiseWillResolve() {
  let promise = new Promise(resolve => {
    let fn = () => resolve('value from promise')
    setTimeout(fn, 500)
  })
  let ch = chan.fromPromise(promise)
  await consume(ch)
}

async function runPromiseWillReject() {
  let promise = new Promise((_, reject) => {
    let fn = () => reject(new Error('error from promise'))
    setTimeout(fn, 500)
  })
  let ch = chan.fromPromise(promise)
  await consume(ch)
}

//
// chan.timeout(ms[, errorMessage])
//

async function runTimeout() {
  let ch = chan.timeout(1000)
  await consume(ch, 5)
  p(`--- if we didn't limit iteration to 5 items, it would go infinitely`)
}

async function runTimeoutWithCustomMessage() {
  let ch = chan.timeout(1000, 'error message')
  await consume(ch, 5)
  p(`--  if we didn't limit iteration to 5 items, it would go infinitely`)
}

//
// chan.signal([value])
//

async function runSignal() {
  let ch = chan.signal()
  sleep(1000).then(() => ch.trigger(`optional value`))
  p(`--  started consumption, waiting...`)
  await consume(ch, 5)
  p(`--  if we didn't limit iteration to 5 items, it would go infinitely`)
}

//
// Run all this stuff.
//

async function consume(ch, maxItems = Number.MAX_SAFE_INTEGER) {
  let i = 0; while (++i <= maxItems) {
    let ret; try {
      ret = await ch.take()
      if (ch.CLOSED == ret) {
        break
      } else {
        p('<-  got value:', ret)
      }
    } catch (err) {
      p('<-  got error:', err.message)
    }
  }
  if (i > maxItems) {
    p(`<-  max of ${ maxItems } items consumed`)
  }
  if (ch.isClosed) {
    p('<-  chan closed')
  }
}

async function run() {
  header(`chan.delay(1000, 'delayed value')`)
  await runDelay()
  header(`chan.fromPromise(promise) (will resolve)`)
  await runPromiseWillResolve()
  header(`chan.fromPromise(promise) (will reject)`)
  await runPromiseWillReject()
  header(`chan.timeout(1000)`)
  await runTimeout()
  header(`chan.timeout(1000, 'error message')`)
  await runTimeoutWithCustomMessage()
  header(`chan.signal()`)
  await runSignal()
}

function header(ch) {
  p(`\n--- ${ch}\n--`)
}

run().catch(p)
