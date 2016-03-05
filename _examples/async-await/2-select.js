import chan from '../../es6'

async function producer(name, ch, items) {
  for (let item of items) {
    console.log(`[${ name }] putting item: ${ item }...`)
    await ch.put(item)
    console.log(`[${ name }] done putting item: ${ item }`)
  }
  console.log(`[${ name }] finished, closing channel`)
  ch.close()
}

async function consumer(ch1, ch2) {
  while (true) {
    console.log(`[c] waiting for item...`)
    let chTimeout = chan.timeout(300)
    // the await statement will throw on timeout
    switch (await chan.select(ch1, ch2, chTimeout)) {
      case ch1:
        console.log(`[c] got item from P-1: ${ ch1.value }`)
        break
      case ch2:
        console.log(`[c] got item from P-2: ${ ch2.value }`)
        break
      case chan.CLOSED:
        console.log(`[c] all non-timeout chans closed`)
        return
    }
  }
}

let ch1 = new chan()
let ch2 = new chan()

ch1.name = 'ch1'
ch2.name = 'ch2'

producer('P-1', ch1, [ 'a', 'b' ]).catch(logError)
producer('P-2', ch2, [ '1', '2' ]).catch(logError)

consumer(ch1, ch2).catch(logError)

function logError(err) {
  console.log(err.stack)
}
