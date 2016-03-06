import chan from '../../es6'

let ch = new chan()

async function producerThatRespectsBackpressure() {
  await ch.send('a')
  await ch.send('b')
  await ch.send('c')
}

function producerThatDoesntRespectBackpressure() {
  ch.send(1)
  ch.send(2)
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
