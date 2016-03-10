import chan from '../../src'
import {p, sleep} from '../utils'

function* $fibonacci() {
  let pre = 0, cur = 1
  while (true) {
    p(` -> producing: ${cur}`)
    yield cur
    cur = pre + cur
    pre = cur - pre
  }
}

async function consume(ch, n = Number.MAX_SAFE_INTEGER) {
  let i = 0
  while (++i <= n && ch.CLOSED != await ch.take()) {
    p('<-  got value:', ch.value)
  }
  if (i > n) {
    p(`<-  consumed max of ${n} items`)
  } else {
    p('<-  chan closed')
  }
}

async function run() {
  let ch = chan.fromGenerator($fibonacci(30))
  p(' -> consuming 3 items...')
  await consume(ch, 3)
  p(' -> sleeping...')
  await sleep(500)
  p(' -> consuming 5 items')
  await consume(ch, 5)
}

run().catch(p)
