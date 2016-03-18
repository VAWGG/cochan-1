var chan = require('../..')
var utils = require('../utils')
var p = utils.p
var sleep = utils.sleep

function producer(ch, items) {
  var i = 0
  function sendNextItem() {
    if (i >= items.length) {
      return close()
    }
    p(' -> sending item: ' + items[i] + '...')
    ch.send(items[i]).then(doneSendingItem)
  }
  function doneSendingItem() {
    ++i; sleep(0).then(sendNextItem)
  }
  function close() {
    p(' -> closing channel...')
    ch.close().then(closed)
  }
  function closed() {
    p(' -> done closing channel')
  }
  sendNextItem()
}

function consumer(ch) {
  function takeNextItem() {
    ch.take().then(gotItem)
  }
  function gotItem(item) {
    if (item == ch.CLOSED) {
      return channelClosed()
    }
    p('<-  got item:', item)
    takeNextItem()
  }
  function channelClosed() {
    p('<-  channel closed')
  }
  takeNextItem()
}

// allow buffering up to 3 items without blocking
var ch = chan(3)

Promise.resolve().then(function() {
  var items = [ 1, 2, 3, 4, 5 ]
  producer(ch, items)
  return sleep(500)
})
.then(function() {
  consumer(ch)
})
.catch(p)
