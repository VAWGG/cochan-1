import chan from '../../src'
import {p, sleep} from '../utils'

// This is not the most performant implementation,
// because it doesn't use non-blocking operations
// to receive and send as much data as possible in
// the same tick of event loop.
//
async function pipe(src, dst) {
  let running = true; while (running) {
    let value = await src.take()
    if (value === chan.CLOSED || !dst.isActive) {
      running = false
    } else {
      await dst.send(value)
    }
  }
}

async function run() {
  let chInp = chan(0)
  let chOut = chan(0)
  let chTimeout = chan.timeout(500)

  pipe(chOut, chInp).catch(p)

  let i = 1; while (true) {
    switch (await chan.select( chInp.take(), chOut.send(i), chTimeout )) {
      case chInp:
        p(`received: ${ chInp.value }`)
        break
      case chOut:
        p(`sent: ${i}`)
        ++i
        break
      case chan.CLOSED:
        p(`both chans closed`)
        return
    }
  }
}

run().catch(err => p(`run() failed with`, err.stack))
