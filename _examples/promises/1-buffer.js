var chan = require('../..')

// allow buffering up to 3 items without blocking
var ch = new chan(3)

function producer(items) {
  var i = 0
  function putNextItem() {
    if (i >= items.length) {
      return close()
    }
    console.log(`[P] putting item: ${ items[i] }...`)
    ch.put(items[i]).then(donePuttingItem)
  }
  function donePuttingItem() {
    ++i; chan.delay(0).then(putNextItem)
  }
  function close() {
    console.log(`[P] closing channel...`)
    ch.close().then(closed)
  }
  function closed() {
    console.log(`[P] channel closed`)
  }
  putNextItem()
}

function consumer() {
  function takeNextItem() {
    ch.take().then(gotItem)
  }
  function gotItem(item) {
    if (item == ch.CLOSED) {
      return channelClosed()
    }
    console.log(`[c] got item: ${ item }`)
    takeNextItem()
  }
  function channelClosed() {
    console.log(`[c] finished`)
  }
  takeNextItem()
}


producer([ 1, 2, 3, 4, 5 ])
chan.delay(100).then(consumer)
