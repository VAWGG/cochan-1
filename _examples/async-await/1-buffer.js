import chan from '../../es6'

// allow buffering up to 3 items without blocking
let ch = new chan(3)

async function producer(items) {
  for (let item of items) {
    console.log(`[P] putting item: ${ item }...`)
    await ch.put(item)
    await chan.delay(0).take()
  }
  console.log(`[P] closing channel...`)
  await ch.close()
  console.log(`[P] channel closed`)
}

async function consumer() {
  while (true) {
    let item = await ch.take()
    if (item == ch.CLOSED) break
    console.log(`[c] got item: ${ item }`)
  }
  console.log(`[c] finished`)
}

(async function() {
  producer([ 1, 2, 3, 4, 5 ])
  await chan.delay(500).take()
  consumer()
})()
