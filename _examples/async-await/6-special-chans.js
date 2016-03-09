import chan from '../../src'
import {p} from '../utils'

async function consume(ch, maxItems = Number.MAX_SAFE_INTEGER) {
  let i = 0; while (++i <= maxItems) {
    let ret; try {
      ret = await ch.take()
      if (ch.CLOSED == ret) {
        break
      } else {
        p('<-- got value:', ret)
      }
    } catch (err) {
      p('<-- got error:', err.message)
    }
  }
  if (i > maxItems) {
    p(`<-- max of ${ maxItems } items consumed`)
  }
  if (ch.isClosed) {
    p('<-- chan closed')
  }
}

async function runDelay() {
  p(`\n--- chan.delay(1000, 'delayed value')\n---`)

  let ch = chan.delay(1000, 'delayed value')
  await consume(ch)
}

async function runPromiseWillResolve() {
  p(`\n--- chan.fromPromise(promiseThatWillResolve)\n---`)

  let promise = new Promise(resolve => {
    let fn = () => resolve('value from promise')
    setTimeout(fn, 500)
  })

  let ch = chan.fromPromise(promise)
  await consume(ch)
}

async function runPromiseWillReject() {
  p(`\n--- chan.fromPromise(promiseThatWillReject)\n---`)

  let promise = new Promise((_, reject) => {
    let fn = () => reject(new Error('error from promise'))
    setTimeout(fn, 500)
  })

  let ch = chan.fromPromise(promise)
  await consume(ch)
}

async function runTimeout() {
  p(`\n--- chan.timeout(1000)\n---`)

  let ch = chan.timeout(1000)
  await consume(ch, 5)

  p(`--- if we didn't limit iteration to 5 items, it would go infinitely`)
}

async function runTimeoutWithCustomMessage() {
  p(`\n--- chan.timeout(1000, 'error message')\n---`)

  let ch = chan.timeout(1000, 'error message')
  await consume(ch, 5)

  p(`--- if we didn't limit iteration to 5 items, it would go infinitely`)
}

async function run() {
  await runDelay()
  await runPromiseWillResolve()
  await runPromiseWillReject()
  await runTimeout()
  await runTimeoutWithCustomMessage()
}

run().catch(p)
