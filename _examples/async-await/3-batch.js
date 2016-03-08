import chan from '../../src'
import {p, sleep} from '../utils'

async function batchProducer(items, ch) {
  items = items.slice()
  while (items.length) {
    let item = items.shift()
    p(' -> sending item:', item)
    if (!ch.sendSync(item)) {
      p(' -> send sync failed, waiting until sent...')
      await ch.send(item)
    }
  }
  p(' -> done sending all items, closing channel...')
  await ch.close()
  p(' -> done closing channel')
}

async function batchConsumer(ch) {
  while (true) {
    p('<-  ' + (ch.canTakeSync ? 'taking next item (sync)' : 'waiting for next item...'))
    let item = ch.takeSync() ? ch.value : await ch.take()
    if (item != chan.CLOSED) {
      p('<-  got item:', ch.value)
    } else {
      p('<-  channel closed')
      break
    }
  }
}

/**
 * Another way of writing the same batch consumer,
 * that uses maybeCanTakeSync().
 */
async function batchConsumerVariant(ch) {
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
