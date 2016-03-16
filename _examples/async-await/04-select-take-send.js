import chan from '../../src'
import {p, sleep} from '../utils'


async function producer(ch, items) {
  p(` -> started producing into ${ ch }`)
  for (let item of items) {
    if (ch.canSend) {
      p(` -> sending: ${ item }...`)
      await ch.send(item)
    } else {
      p(` -> chan ${ch} closed`)
      return
    }
  }
  p(` -> finished producing into ${ ch }`)
}


async function consumer(ch, n = Number.MAX_SAFE_INTEGER) {
  p(`<-  started consuming from ${ ch }`)
  let i = 0
  while (++i <= n && ch.CLOSED != await ch.take()) {
    p(`<-  got:`, ch.value)
  }
  if (i > n) {
    p(`<-  consumed max of ${n} items`)
  } else {
    p(`<-  chan closed`)
  }
}


async function worker(chIn, chOut) {
  let i = 1; while (true) {
    switch (await chan.select( chIn.take(), chOut.send(i) )) {
      case chIn:
        p(`... received from ${ chIn }: ${ chIn.value }`)
        break
      case chOut:
        p(`... sent to ${ chOut }: ${i}`)
        ++i
        break
      case chan.CLOSED:
        p(`... both chIn and chOut have closed`)
        return
    }
  }
}


async function run() {
  //
  // [producer]>--A-->[worker]>--B-->[consumer]
  //
  let chA = new chan(0).named('A')
  let chB = new chan(0).named('B')

  worker(chA, chB).catch(p)
  producer(chA, [ 'X', 'Y', 'Z', 'P', 'Q' ]).catch(p)
  consumer(chB, 5).catch(p)

  await sleep(500)
  p(`--- closing both channels...`)

  await Promise.all([ chA.close(), chB.close() ])
  p(`--- done`)
}


run().catch(p)
