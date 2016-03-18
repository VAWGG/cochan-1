import chan from '../../src'
import {p} from '../utils'

async function thread(index, chData, chTimeout) {
  // On timeout, chTimeout will produce error, so the Promise returned
  // from chan.select will get rejected, which, in turn, will cause
  // the await operation to throw.
  switch (await chan.select( chData, chTimeout )) {
    case chData: return p(`thread ${index} got data:`, chData.value)
    case chan.CLOSED: return p(`thread ${index}: chan ${chData} closed`)
  }
}

function run() {
  let chData = chan()
  let chTimeout = chan.timeout(1000, `my bear got ill`)

  thread(1, chData, chTimeout).catch(errorInThread(1))
  thread(2, chData, chTimeout).catch(errorInThread(2))
  thread(3, chData, chTimeout).catch(errorInThread(3))

  chData.send('x')
}

function errorInThread(threadIndex) {
  return err => p(`thread ${threadIndex} error: ${err.message}`)
}

run()
