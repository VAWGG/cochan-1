import chan from '../../es6'

let ch = new chan()

async function producerThatRespectsBackpressure() {
  await ch.put('a')
  await ch.put('b')
  await ch.put('c')
}

function producerThatDoesntRespectBackpressure() {
  ch.put(1)
  ch.put(2)
}

async function consumer() {
  while (true) {
    let item = await ch.take()
    if (item == ch.CLOSED) break
    console.log(item)
  }
  console.log(`channel closed`)
}

producerThatRespectsBackpressure()
producerThatDoesntRespectBackpressure()
consumer()

setTimeout(() => ch.close(), 100)
