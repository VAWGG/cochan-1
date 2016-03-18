import chan from '../../src'
import {p} from '../utils'

let ch = chan()

async function producerThatRespectsBackpressure() {
  await ch.send('a')
  await ch.send('b')
  await ch.send('c')
}

function producerThatDoesntRespectBackpressure() {
  ch.send(1)
  ch.send(2)
}

async function consumer() {
  while (true) {
    let item = await ch.take()
    if (item == ch.CLOSED) break
    p(item)
  }
  p(`channel closed`)
}

producerThatRespectsBackpressure().catch(p)
producerThatDoesntRespectBackpressure()
consumer().catch(p)

setTimeout(() => ch.close(), 500)
