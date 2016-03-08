import chan from '../../src'
import {p, sleep} from '../utils'

async function batchProducer(items, ch) {
  items = items.slice()
  p(' -> waiting until can send...')
  while (await ch.maybeCanSendSync()) {
    while (ch.canSendSync && items.length) {
      p(' -> sending item:', items[0])
      ch.sendSync(items.shift())
    }
    if (!items.length) {
      p(' -> done sending all items, closing channel...')
      await ch.close()
      p(' -> done closing channel')
      return
    }
    p(' -> waiting until can send...')
  }
}

async function batchConsumer(ch) {
  p('<-  waiting until can take...')
  while (await ch.maybeCanTakeSync()) {
    while (ch.takeSync()) {
      p('<-  got item:', ch.value)
    }
    p('<-  waiting until can take...')
  }
  p('<-  channel closed')
}

async function run() {
  let ch = new chan(3)
  let items = 'abcdef'.split('')
  batchProducer(items, ch).catch(p)
  await sleep(500)
  batchConsumer(ch).catch(p)
}

run().catch(p)
