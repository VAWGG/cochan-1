import chan from '../../src'
import {p, sleep} from '../utils'

async function producer(ch, items) {
  for (let item of items) {
    p(` -> sending item: ${ item }...`)
    await ch.send(item)
  }
  p(` -> closing channel...`)
  await ch.close()
  p(` -> done closing channel`)
}

async function consumer(ch) {
  while (true) {
    let item = await ch.take()
    if (item == ch.CLOSED) break
    p(`<-  got item: ${ item }`)
  }
  p(`<-  channel closed`)
}

async function run() {
  // allow buffering up to 3 items without blocking
  let ch = chan(3)
  let items = [ 1, 2, 3, 4, 5 ]
  producer(ch, items).catch(p)
  await sleep(500)
  consumer(ch).catch(p)
}

run().catch(p)
