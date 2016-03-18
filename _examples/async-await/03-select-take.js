import chan from '../../src'
import {p, sleep} from '../utils'

async function producer(name, ch, items) {
  for (let item of items) {
    p(`${ name }-> sending item: ${ item }...`)
    await ch.send(item)
    p(`${ name }-> done sending item: ${ item }`)
  }
  p(`${ name }-> all items sent, closing channel...`)
  await ch.close()
  p(`${ name }-> channel closed`)
}

async function consumer(ch1, ch2) {
  while (true) {
    p(`<-  waiting for item...`)
    switch (await chan.select(ch1, ch2)) {
      case ch1:
        p(`<-  got item from ${ ch1.name }: ${ ch1.value }`)
        break
      case ch2:
        p(`<-  got item from ${ ch2.name }: ${ ch2.value }`)
        break
      case chan.CLOSED:
        p(`<-  all non-timeout chans closed`)
        return
    }
  }
}

function run() {
  let ch1 = chan().named('chan 1')
  let ch2 = chan().named('chan 2')

  producer('1', ch1, [ 'a', 'b' ]).catch(p)
  producer('2', ch2, [ 'X', 'Y' ]).catch(p)

  consumer(ch1, ch2).catch(p)
}

run()
