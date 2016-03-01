import chan from '../..'

function runProducer(name, ch, items) {
  async function producer() {
    for (let item of items) {
      console.log(`[${ name }] putting item: ${ item }...`)
      await ch.put(item)
      console.log(`[${ name }] done putting item: ${ item }`)
    }
    console.log(`[${ name }] finished`)
    ch.close()
  }
  producer().catch(logError)
}

async function consumer(ch1, ch2) {
  while (true) {
    console.log(`[c] waiting for item...`)
    // this line will throw on timeout, because chan.timeout(ms)
    // returns a Promise that gets rejected after the timeout
    let sel = await chan.select(ch1, ch2, chan.timeout(300))
    switch (sel.chan) {
      case ch1:
        console.log(`[c] got item from P-1: ${ sel.value }`)
        break
      case ch2:
        console.log(`[c] got item from P-2: ${ sel.value }`)
        break
      case chan.CLOSED:
        console.log(`[c] all non-timeout chans closed`)
        return
    }
  }
}

function logError(err) {
  console.log(err.stack)
}

let ch1 = new chan()
let ch2 = new chan()

ch1.name = 'ch1'
ch2.name = 'ch2'

runProducer('P-1', ch1, [ 'a', 'b' ])
runProducer('P-2', ch2, [ '1', '2' ])

consumer(ch1, ch2).catch(logError)
