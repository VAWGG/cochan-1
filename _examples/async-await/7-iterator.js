import chan from '../../src'
import {p, sleep} from '../utils'

class ClosedRangeIterator {

  constructor(countFrom, upto) {
    this._i = countFrom - 1
    this._upto = upto
  }

  next() {
    if (++this._i > this._upto) {
      p(' -> iterator finished')
      return { value: undefined, done: true }
    } else {
      p(' -> iterating:', this._i)
      return { value: this._i, done: false }
    }
  }
}

async function consumer(ch) {
  while (ch.CLOSED != await ch.take()) {
    p('<-  got value:', ch.value)
    await sleep(50)
  }
  p('<-  chan closed')
}

async function run() {
  p('--- chan.fromIterable')

  let ch1 = chan.fromIterable('abcde')
  await consumer(ch1)

  p('--- chan.fromIterator')

  let iter = new ClosedRangeIterator(3, 7)
  let ch2 = chan.fromIterator(iter)
  await sleep(500)
  await consumer(ch2)
}

run().catch(p)
