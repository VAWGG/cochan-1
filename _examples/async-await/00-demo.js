import chan from '../../src'
import {p, sleep} from '../utils'

//
// Press Ctrl+C to stop this example.
//

async function generateWork(ctx) {
  let chNewWork = chan.fromPromise(ctx.requestWork())
  let chCanSend = null
  while (true) {
    switch (await chan.select( chNewWork, chCanSend, ctx.cancel )) {
      case chNewWork: // got new work
        p(` -> got new work: ${chNewWork.value}`)
        chCanSend = chan.fromPromise(ctx.work.maybeCanSendSync())
        break
      case chCanSend: // probably can send work
        if (ctx.work.sendSync(chNewWork.value)) { // work sent, can request more
          p(` -> requesting more work...`)
          chNewWork = chan.fromPromise(ctx.requestWork())
        } else {
          chCanSend = chan.fromPromise(ctx.work.maybeCanSendSync())
        }
        break
      case ctx.cancel:
        console.log(`--- work generator cancelled, reason: ${ctx.cancel.value}`)
        return
    }
  }
}


async function worker(index, ctx) {
  let chWork = ctx.work
  let chResult = null
  let opSendResult = null
  while (true) {
    switch (await chan.select( chWork, chResult, opSendResult, ctx.cancel )) {
      case chWork: // got new work
        p(`[${index}] got new work ${chWork.value}, performing...`)
        chResult = chan.fromPromise(ctx.performWork(chWork.value))
        chWork = null // disable input chan until the work is done and sent
      break
      case chResult: // got work result
        p(`[${index}] got work result ${chResult.value}, sending...`)
        opSendResult = ctx.results.send(chResult.value)
      break
      case ctx.results: // result sent, can query more work
        p(`[${index}] work result sent, requesting more work...`)
        chWork = ctx.work
        opSendResult = null
      break
      case ctx.cancel: // cancelled
        console.log(`[${index}] worker cancelled, reason: ${ctx.cancel.value}`)
        return
    }
  }
}


function run({ requestWork, performWork, maxParallel, workBufferingRatio, resultsBufferingRatio }) {
  let ctx = { requestWork, performWork,
    work: new chan(Math.ceil(maxParallel * workBufferingRatio)),
    results: new chan(Math.ceil(maxParallel * resultsBufferingRatio)),
    cancel: chan.signal()
  }
  for (let i = 0; i < maxParallel; ++i) {
    worker(i, ctx).catch(onError)
  }
  generateWork(ctx).catch(onError)
  return {
    results: ctx.results,
    cancel: (reason) => {
      ctx.cancel.trigger(reason)
      ctx.results.close()
    }
  }
}


async function consumeResults(ch) {
  while (chan.CLOSED != await ch.take()) {
    console.log(`<-  consuming result: ${ch.value}`)
    await sleep(Math.random() > 0.9 ? 3000 : Math.floor(100 * Math.random()))
    console.log(`<-  result ${ch.value} consumed`)
  }
}


function onError(err) {
  console.log(err.stack)
  process.exit(1)
}


function makeRequestWork() {
  let i = 0
  return function requestWork() {
    return new Promise(resolve => {
      let done = () => resolve(i++)
      let delay = Math.random() > 0.99 ? 5000 : Math.floor(100 * Math.random())
      setTimeout(done, delay)
    })
  }
}


function performWork(work) {
  return new Promise(resolve => {
    let done = () => resolve(`result-${work}`)
    let delay = 1000 + Math.floor(1500 * Math.random())
    setTimeout(done, delay)
  })
}


let processor = run({
  requestWork: makeRequestWork(),
  performWork: performWork,
  maxParallel: 3,
  workBufferingRatio: 1.5,
  resultsBufferingRatio: 0
})


consumeResults(processor.results)


let tid = setInterval(() => p('.'), 500)

process.on('SIGINT', () => {
  p()
  processor.cancel('SIGINT')
  clearInterval(tid)
  p('!!! Node will hang a little till timeouts from makeRequestWork and performWork fire')
})
