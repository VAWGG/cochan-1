import chan from '../../src'
import {p, sleep} from '../utils'

async function producer(ch, name, items) {
  for (let item of items) {
    p(`${name}-> sending ${item}`)
    if (!ch.sendSync(item)) {
      await ch.send(item)
      await sleep(300 * Math.random())
    }
  }
  await ch.close()
  p(`${name}-> finished`)
}

async function consumer(chA, chB, chC) {
  let chMerged = chan.merge(chA, chB, chC)
  while (chan.CLOSED != await chMerged.take()) {
    p(`<-  got value:`, chMerged.value)
  }
  p(`<-  all chans have closed`)
}

function run() {
  let chA = new chan(0)
  let chB = new chan(2)
  let chC = new chan(0)
  producer(chA, 'a', ['a-1', 'a-2']).catch(p)
  producer(chB, 'b', ['b-1', 'b-2', 'b-3']).catch(p)
  producer(chC, 'c', ['c-1', 'c-2']).catch(p)
  consumer(chA, chB, chC).catch(p)
}

run()
