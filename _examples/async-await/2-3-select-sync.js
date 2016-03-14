import chan from '../../src'
import {p} from '../utils'

async function worker(chIn, chOut) {
  let i = 1; while (true) {
    switch (chan.selectSync( chIn.take(), chOut.send(i) )) {
      case chIn:
        p(`received from ${ chIn }: ${ chIn.value }`)
        break
      case chOut:
        p(`sent to ${ chOut }: ${i}`)
        ++i
        break
      case chan.CLOSED:
        p(`both chIn and chOut have closed`)
        return
      default:
        p(`failed to select synchronously`)
        return
    }
  }
}

function run() {
  let chA = new chan(5).named('A')
  let chB = new chan(5).named('B')

  for (let item of 'XYZPQ') {
    chA.sendSync(item)
  }

  worker(chA, chB).catch(p)
}

run()
