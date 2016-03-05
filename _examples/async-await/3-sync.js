import chan from '../../es6'

async function batchProducer(items, ch) {
  items = items.slice()
  p(' -> waiting until can put...')
  while (await ch.maybeCanPutSync()) {
    while (ch.canPutSync && items.length) {
      p(' -> putting item:', items[0])
      ch.putSync(items.shift())
    }
    if (!items.length) {
      p(' -> done putting all items, closing channel...')
      await ch.close()
      p(' -> done closing channel!')
      return
    }
    p(' -> waiting until can put...')
  }
}

async function batchConsumer(ch) {
  p('<-  waiting until can take...')
  while (await ch.maybeCanTakeSync()) {
    while (ch.takeSync()) {
      p('<-  took item:', ch.value)
    }
    p('<-  waiting until can take...')
  }
  p('<-  channel closed')
}

(async function() {
  let ch = new chan(3)
  batchProducer([ 'a', 'b', 'c', 'd', 'e', 'f' ], ch).catch(p)
  await chan.delay(500)
  batchConsumer(ch).catch(p)
})()


function p(err) {
  if (arguments.length == 1 && err instanceof Error) {
    console.log(err.stack)
  } else {
    console.log.apply(console, arguments)
  }
}
