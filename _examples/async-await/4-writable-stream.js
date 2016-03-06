import chan from '../../es6'
import Stream from 'readable-stream'
import {p} from '../utils'

class ProducerStream extends Stream.Readable {

  constructor(items) {
    super({ objectMode: true, highWaterMark: 0 })
    this._items = items.slice()
  }

  _read(size) {
    while (this._items.length) {
      let item = this._items.shift()
      p(' -> producing item:', item)
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
  let stream = new ProducerStream('bobrohata'.split(''))
  stream.pipe(ch)
  await chan.delay(500).take()
  consumer(ch).catch(p)
}

run().catch(p)
