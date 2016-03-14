import chan from '../../src'
import {p, sleep} from '../utils'

function* $worker(name, workItems, cancelCh, globalTimeoutCh) {
  while (workItems.length) {
    let work = workItems.shift(); p(`[${ name }] starting new work "${ work }"...`)
    let resultCh = chan.fromPromise(doWork(work))
    // The chan.select() produces a Promise, so this yield will not result in sending a
    // value into the output channel; instead, it will wait until the promise settles, and
    // pass back the value or error as a result of the yield operation. That's the essence
    // of async generators: allow both producing the values with yield, and awaiting on a
    // Promise. In this particular implementation, we use yield for awaiting too, but there
    // is a proposal that, if accepted by TC39, will allow to use `await` keyword inside
    // generators: https://github.com/tc39/proposal-async-iteration.
    let sel = yield chan.select(resultCh, cancelCh, globalTimeoutCh, chan.timeout(1000))
    switch (sel) {
      case resultCh:
        let result = resultCh.value
        p(`[${ name }] got result for "${ work }": "${ result }"; sending into channel...`)
        // The `result` is not a Promise, so it will be sent to the channel, and
        // yield will return as soon as the `result` is either buffered or consumed.
        yield result
        break
      case cancelCh:
        p(`[${ name }] cancelled`)
        return
      case chan.CLOSED:
        p(`[${ name }] channel closed`)
        return
    }
    // Note: if we didn't want cancel and timeout functionality, we could yield
    // the Promise returned from doWork(work) right away:
    //
    // let work = workItems.shift()
    // let result = yield doWork(work)
    // if (result == chan.CLOSED) break
    // yield result // send into the chan
  }
  p(`[${ name }] finished`)
}

function doWork(work) {
  return new Promise(resolve => {
    let done = () => resolve(randomInt(100))
    setTimeout(done, randomInt(500))
  })
}

function randomInt(max) {
  return Math.floor(max * Math.random())
}

async function run() {
  // we can use this channel to cancel all workers anythime
  let cancelCh = new chan(3)

  if (Math.random() > 0.5) {
    let delay = randomInt(1000)
    let cancel = () => {
      p(`!!! cancelling...`)
      for (let i = 0; i < 3; ++i) {
        cancelCh.sendSync()
      }
    }
    p(`!!! will cancel after ${ delay } ms!`)
    setTimeout(cancel, delay)
  }

  // timeout for the whole run
  let timeoutCh = chan.timeout(5000)

  let gen1 = $worker('a', ['a', 'b', 'c'], cancelCh, timeoutCh)
  let gen2 = $worker('b', ['x', 'y', 'z'], cancelCh, timeoutCh)
  let gen3 = $worker('c', ['1', '2', '3'], cancelCh, timeoutCh)

  let ch1 = chan.fromGenerator(gen1, { async: true })
  let ch2 = chan.fromGenerator(gen2, { async: true })
  let ch3 = chan.fromGenerator(gen3, { async: true })

  let ch = chan.merge(ch1, ch2, ch3)

  while (ch.CLOSED != await ch.take()) {
    p('<-- got value:', ch.value)
  }

  p('<-- chan closed')
}

run().catch(p)
