import chan from '../../src'
import Stream from 'readable-stream'
import {p, sleep} from '../utils'

class ProducerStream extends Stream.Readable {

  constructor(items) {
    super({ objectMode: true, highWaterMark: 0 })
    this._items = items.slice()
  }

  _read(size) {
    while (this._items.length) {
      let item = this._items.shift()
      p(' -> producing stream item:', item)
      if (!this.push(item)) {
        return
      }
    }
    if (!this._items.length) {
      p(' -> all items written, ending the stream')
      this.push(null)
    }
  }
}

async function consumer(ch) {
  p(`<-  started`)
  while (ch.CLOSED !== await ch.take()) {
    p(`<-  got item: ${ ch.value }`)
  }
  p(`<-  channel closed`)
}

async function run() {
  let ch = new chan(3)
  let items = 'bobrohata'.split('')
  let stream = new ProducerStream(items)
  stream.pipe(ch)
  await sleep(500)
  consumer(ch).catch(p)
}

run().catch(p)
