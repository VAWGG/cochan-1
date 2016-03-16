import chan from '../../src'
import {p, sleep} from '../utils'

async function thread(index, chData, chCancel) {
  switch (await chan.select( chData, chCancel )) {
    case chData   : return p(`thread ${index} got data:`, chData.value)
    case chCancel : return p(`thread ${index} cancelled, reason:`, chCancel.value)
  }
}

async function run() {
  let chData = new chan()
  let chCancel = chan.signal()

  thread(1, chData, chCancel).catch(p)
  thread(2, chData, chCancel).catch(p)
  thread(3, chData, chCancel).catch(p)

  chData.send('x')
  await sleep(1000)
  chCancel.trigger(`out of vodka`)
}

run().catch(p)
