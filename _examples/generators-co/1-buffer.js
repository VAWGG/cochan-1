import co from 'co'
import chan from '../../es6'

// allow buffering up to 3 items without blocking
let ch = new chan(3)

function* $producer(items) {
  for (let item of items) {
    console.log(`[P] putting item: ${ item }...`)
    yield ch.put(item)
    yield chan.delay(0).take()
  }
  console.log(`[P] closing channel...`)
  yield ch.close()
  console.log(`[P] channel closed`)
}

function* $consumer() {
  while (true) {
    let item = yield ch.take()
    if (item == ch.CLOSED) break
    console.log(`[c] got item: ${ item }`)
  }
  console.log(`[c] finished`)
}

co(function*() {
  co($producer([ 1, 2, 3, 4, 5 ]))
  yield chan.delay(500).take()
  co($consumer())
})
