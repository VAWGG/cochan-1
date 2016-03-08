import co from 'co'
import chan from '../../src'
import {p, sleep} from '../utils'

function* $producer(ch, items) {
  for (let item of items) {
    p(` -> sending item: ${ item }...`)
    yield ch.send(item)
    yield sleep(0)
  }
  p(` -> closing channel...`)
  yield ch.close()
  p(` -> done closing channel`)
}

function* $consumer(ch) {
  while (true) {
    let item = yield ch.take()
    if (item == ch.CLOSED) break
    p(`<-  got item: ${ item }`)
  }
  p(`<-  channel closed`)
}

function* $run() {
  // allow buffering up to 3 items without blocking
  let ch = new chan(3)
  let items = [ 1, 2, 3, 4, 5 ]
  co($producer(ch, items)).catch(p)
  yield sleep(500)
  co($consumer(ch)).catch(p)
}

co($run()).catch(p)
