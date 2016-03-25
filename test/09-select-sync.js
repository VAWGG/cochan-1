import {test, randomInsert} from './helpers'
import chan from '../src'

test.timeout(5000)

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`selectSync(...ops) returns chan.CLOSED given no arguments`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  t.ok(chan.CLOSED === chan.selectSync())
})

test(`returns chan.CLOSED given only falsy args`, async t => {
  t.ok(chan.CLOSED === chan.selectSync(null, false, undefined, 0))
})

test(`returns chan.CLOSED given take op from a closed chan`, async t => {
  let ch = chan()
  ch.closeNow()
  t.ok(chan.CLOSED === chan.selectSync( ch.take() ))
  t.ok(chan.CLOSED === chan.selectSync( ch ))
})

test(`returns chan.CLOSED given send op into a closed chan`, async t => {
  let ch = chan()
  ch.closeNow()
  t.ok(chan.CLOSED === chan.selectSync( ch.send('e') ))
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given the only send op that cannot be performed sync, returns null and doesn't ` +
  `perform that send, even asynchronously`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  t.ok(null === chan.selectSync( ch.send('e') ))
  await t.nextTurn()

  t.ok(false == ch.takeSync())
})

test(`given the only take op that cannot be performed sync, returns null and doesn't ` +
  `perform that take, even asynchronously`,
async t => {
  let ch = chan()

  t.ok(null === chan.selectSync( ch.take() ))
  await t.nextTurn()

  t.ok(false == ch.sendSync('e'))
})

test(`given the only chan that cannot be taken from sync, returns null and doesn't ` +
  `perform take op, even asynchronously`,
async t => {
  let ch = chan()

  t.ok(null === chan.selectSync( ch ))
  await t.nextTurn()

  t.ok(false == ch.sendSync('e'))
})

test(`when no ops can be performed sync, returns null and doesn't perform any of ` +
  `the ops, even asynchronously`,
async t => {
  let chA = chan()
  let chB = chan()

  t.ok(null === chan.selectSync( chA.send(0), chB.send(1) ))
  await t.nextTurn()
  t.ok(false == chA.takeSync())
  t.ok(false == chB.takeSync())

  t.ok(null === chan.selectSync( chA.take(), chB.send(0) ))
  await t.nextTurn()
  t.ok(false == chA.sendSync(0))
  t.ok(false == chB.takeSync())

  t.ok(null === chan.selectSync( chA, chB.send(0) ))
  await t.nextTurn()
  t.ok(false == chA.sendSync(0))
  t.ok(false == chB.takeSync())

  t.ok(null === chan.selectSync( chA.send(0), chB.take() ))
  await t.nextTurn()
  t.ok(false == chA.takeSync())
  t.ok(false == chB.sendSync(0))

  t.ok(null === chan.selectSync( chA.send(0), chB ))
  await t.nextTurn()
  t.ok(false == chA.takeSync())
  t.ok(false == chB.sendSync(0))

  t.ok(null === chan.selectSync( chA.take(), chB.take() ))
  await t.nextTurn()
  t.ok(false == chA.sendSync(0))
  t.ok(false == chB.sendSync(0))

  t.ok(null === chan.selectSync( chA, chB ))
  await t.nextTurn()
  t.ok(false == chA.sendSync(0))
  t.ok(false == chB.sendSync(0))
})

test(`when no ops can be performed sync, returns null and doesn't perform any of ` +
  `the ops, even asynchronously (same chan)`,
async t => {
  let ch = chan()

  t.ok(null === chan.selectSync( ch.send(1), ch.send(2) ))
  await t.nextTurn()
  t.ok(false == ch.takeSync())

  t.ok(null === chan.selectSync( ch.take(), ch.take() ))
  await t.nextTurn()
  t.ok(false == ch.sendSync(1))

  t.ok(null === chan.selectSync( ch, ch ))
  await t.nextTurn()
  t.ok(false == ch.sendSync(1))
})

test(`returns null given send op on a closing chan`, async t => {
  let ch = chan(1)
  ch.sendSync('x')
  ch.close()
  t.ok(null === chan.selectSync( ch.send('e') ))
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns chan.CLOSED and doesn't perform any op if all non-timeout chans are closed (case 1)`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let tch = chan.timeout(0)

  ch.closeSync()
  await t.sleep(10)

  let sel = chan.selectSync( ch.take(), tch )

  t.ok(sel === chan.CLOSED)
})

test(`returns chan.CLOSED and doesn't perform any op if all non-timeout chans are closed (case 2)`,
async t => {
  let ch = chan()
  let tch1 = chan.timeout(0)
  let tch2 = chan.timeout(0)

  ch.closeSync()
  await t.sleep(10)

  let sel = chan.selectSync( tch1.take(), ch.take(), tch2 )
  t.ok(sel === chan.CLOSED)
})

test(`returns chan.CLOSED and doesn't perform any op if all non-timeout chans are closed (case 3)`,
async t => {
  let ch1 = chan()
  let ch2 = chan()

  let tch1 = chan.timeout(0)
  let tch2 = chan.timeout(0)

  ch1.closeSync()
  ch2.closeSync()

  await t.sleep(10)

  let sel = chan.selectSync( tch1.take(), ch1.take(), tch2.take(), ch2.send('x') )
  t.ok(sel === chan.CLOSED)
})

test(`returns chan.CLOSED and doesn't perform any op if all non-timeout chans are closed (case 4)`,
async t => {
  let ch1 = chan()
  let ch2 = chan()

  let tch1 = chan.timeout(0)
  let tch2 = chan.timeout(0)

  ch1.closeSync()
  ch2.closeSync()

  await t.sleep(10)

  let sel = chan.selectSync( false, tch1.take(), ch1.take(), null, tch2.take(), ch2.send('x'), 0 )
  t.ok(sel === chan.CLOSED)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`throws given any arg that is not falsy, chan, or op`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  t.throws(() => chan.selectSync({}))
  t.throws(() => chan.selectSync(true))
  t.throws(() => chan.selectSync('ururu'))
  t.throws(() => chan.selectSync(ch, {}))
  t.throws(() => chan.selectSync({}, ch))
  t.throws(() => chan.selectSync(ch, true))
  t.throws(() => chan.selectSync(true, ch))
  t.throws(() => chan.selectSync({}, true))
})

test(`throws given an op that was initialed not on the current tick`, async t => {
  let chX = chan(1)
  let chY = chan()

  let opSend = chX.send('x')
  let opTake = chY.take()

  await t.nextTick()

  t.throws(() => chan.selectSync(opSend))
  t.throws(() => chan.selectSync(chY, opSend))
  t.throws(() => chan.selectSync(opSend, chY))
  t.throws(() => chan.selectSync(opSend, chY.take()))
  t.throws(() => chan.selectSync(chY.take(), opSend))

  t.throws(() => chan.selectSync(opTake))
  t.throws(() => chan.selectSync(chX, opTake))
  t.throws(() => chan.selectSync(opTake, chX))
  t.throws(() => chan.selectSync(opTake, chX.take()))
  t.throws(() => chan.selectSync(chX.take(), opTake))

  t.throws(() => chan.selectSync(opTake, opSend))
  t.throws(() => chan.selectSync(opSend, opTake))
})

test(`throws when the same op instance gets passed in two selectSync operations`, async t => {
  let chX = chan(1)
  let chY = chan(1)
  let op = chX.send('x')

  t.ok(chX === chan.selectSync(op))
  t.throws(() => chan.selectSync( op, chY.send('e') ))

  await t.nextTurn()
  t.ok(false == chY.takeSync()) // chY.send('e') was not performed

  chX = chan()
  chY = chan(1)
  op = chX.take()

  t.ok(null === chan.selectSync(op))
  t.throws(() => chan.selectSync( op, chY.send('e') ))

  await t.nextTurn()
  t.ok(false == chY.takeSync()) // chY.send('e') was not performed
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`in the presence of non-closed non-timeout chans, throws given a take on a timeout chan ` +
  `that can be performed sync (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let tch = chan.timeout(0)
  await t.sleep(10)
  t.throws(() => chan.selectSync( ch.take(), tch.take() ), /timeout/)
})

test(`in the presence of non-closed non-timeout chans, throws given a take on a timeout chan ` +
  `that can be performed sync (case 2)`,
async t => {
  let ch = chan()
  let tch1 = chan.timeout(0, 'alas')
  let tch2 = chan.timeout(100000, 'oops')
  await t.sleep(10)
  t.throws(() => chan.selectSync( ch.take(), tch1.take(), tch2 ), /alas/)
})

test(`throws given a take on a timeout chan that can be performed sync, even if other ops ` +
  `on a non-timeout chans can be performed sync too (case 1)`,
async t => {
  let ch = chan(1)
  let tch = chan.timeout(0)
  await t.sleep(10)
  // to fight potential randomness of op selection
  for (let i = 0; i < 10; ++i) {
    t.throws(() => chan.selectSync( ch.send('e'), tch ), /timeout/)
  }
  t.ok(true == ch.sendSync('x'))
})

test(`throws given a take on a timeout chan that can be performed sync, even if other ops ` +
  `on a non-timeout chans can be performed sync too (case 1)`,
async t => {
  let ch1 = chan(1)
  let ch2 = chan(1)
  let tch = chan.timeout(0)

  ch2.send('x')
  await t.sleep(10)

  // to fight potential randomness of op selection
  for (let i = 0; i < 10; ++i) {
    t.throws(() => chan.selectSync( ch1.send('e'), tch, ch2.take() ), /timeout/)
  }

  t.ok(true == ch1.sendSync('x'))
  t.ok(true == ch2.takeSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one take op that can be performed sync, performs it and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendSync('x')
  t.ok(ch === chan.selectSync( ch.take() ))
  t.ok('x' == ch.value)
})

test(`given one chan that can be taken from sync, performs take and returns the chan`, async t => {
  let ch = chan(1)
  ch.sendSync('x')
  t.ok(ch === chan.selectSync( ch ))
  t.ok('x' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one take op that can be performed sync, performs it and returns its chan, even if ` +
  `that chan becomes closed as a result of that op`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendSync('x')
  let pClosed = ch.close()
  t.ok(ch === chan.selectSync( ch.take() ))
  t.ok('x' == ch.value)
  await pClosed
})

test(`given one chan that can be taken from sync, performs take and returns the chan, even if ` +
  `it becomes closed as a result of that take`, async t => {
  let ch = chan(1)
  ch.sendSync('x')
  let pClosed = ch.close()
  t.ok(ch === chan.selectSync( ch ))
  t.ok('x' == ch.value)
  await pClosed
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given send op on that can be performed sync, performs it and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  t.ok(ch === chan.selectSync( ch.send('x') ))
  t.ok(true == ch.takeSync())
  t.ok('x' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given two take ops, only one of which can be performed sync, performs that op ` +
  `and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 2; ++i) {
    let chS = chan(1).named('chS')
    let chA = chan(0).named('chA')

    chS.sendSync('x')

    let sel = i == 0
      ? chan.selectSync(chS.take(), chA.take())
      : chan.selectSync(chA.take(), chS.take())

    t.ok(sel === chS)
    t.ok('x' == chS.value)

    await t.nextTurn()
    t.ok(false == chA.sendSync('x'))
  }
})

test(`given two chans, only one of which can be taken from sync, performs take on, and ` +
  `returns that chan`,
async t => {
  for (let i = 0; i < 2; ++i) {
    let chS = chan(1).named('chS')
    let chA = chan(0).named('chA')

    chS.sendSync('x')

    let sel = i == 0
      ? chan.selectSync(chS, chA)
      : chan.selectSync(chA, chS)

    t.ok(sel === chS)
    t.ok('x' == chS.value)

    await t.nextTurn()
    t.ok(false == chA.sendSync('x'))
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given two send ops, only one of which can be performed sync, performs that op ` +
  `and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 2; ++i) {
    let chS = chan(1).named('chS')
    let chA = chan(0).named('chA')

    let sel = i == 0
      ? chan.selectSync(chS.send('s'), chA.send('a'))
      : chan.selectSync(chA.send('a'), chS.send('s'))

    t.ok(sel === chS)
    t.ok(true == chS.takeSync())
    t.ok('s' == chS.value)

    await t.nextTurn()
    t.ok(false == chA.takeSync())
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given two ops: one send op that can be performed sync, and one take op which cannot, ` +
  `performs send op and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 2; ++i) {
    let chS = chan(1).named('chS')
    let chA = chan(0).named('chA')

    let sel = i == 0
      ? chan.selectSync(chS.send('x'), chA.take())
      : chan.selectSync(chA.take(), chS.send('x'))

    t.ok(sel === chS)
    t.ok(true == chS.takeSync())
    t.ok('x' == chS.value)

    await t.nextTurn()
    t.ok(false == chA.sendSync('x'))
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given two ops: one take op that can be performed sync, and one send op which cannot, ` +
  `performs take op and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 2; ++i) {
    let chS = chan(1).named('chS')
    let chA = chan(0).named('chA')

    chS.sendSync('x')

    let sel = i == 0
      ? chan.selectSync(chS.take(), chA.send('e'))
      : chan.selectSync(chA.send('e'), chS.take())

    t.ok(sel === chS)
    t.ok('x' == chS.value)

    await t.nextTurn()
    t.ok(false == chA.takeSync())
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given two take ops that can be performed sync, performs random one and returns its chan`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 10; ++i) {
    let chX = chan(1).named('chX')
    let chY = chan(2).named('chY')

    chX.sendSync('x')
    chY.sendSync('y')

    let sel = chan.selectSync(chX.take(), chY.take())
    t.ok(sel === chX || sel === chY)

    if (sel == chX) {
      t.ok('x' == chX.value)
      await t.nextTurn()
      t.ok(true == chY.takeSync())
    } else {
      t.ok('y' == chY.value)
      await t.nextTurn()
      t.ok(true == chX.takeSync())
    }
  }
})

test(`given two chans that can be taken from sync, performs take on a random chan and returns ` +
  `the selected chan`,
async t => {
  for (let i = 0; i < 10; ++i) {
    let chX = chan(1).named('chX')
    let chY = chan(2).named('chY')

    chX.sendSync('x')
    chY.sendSync('y')

    let sel = chan.selectSync(chX, chY)
    t.ok(sel === chX || sel === chY)

    let [value, nonSel] = sel === chX ? ['x', chY] : ['y', chX]
    t.ok(value == sel.value)

    await t.nextTurn()
    t.ok(true == nonSel.takeSync())
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given two send ops that can be performed sync, performs random one and returns its chan`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  for (let i = 0; i < 10; ++i) {
    let chX = chan(1).named('chX')
    let chY = chan(3).named('chY')

    let sel = chan.selectSync(chX.send('x'), chY.send('y'))
    t.ok(sel === chX || sel === chY)

    let [value, nonSel] = sel === chX ? ['x', chY] : ['y', chX]

    t.ok(true === sel.takeSync())
    t.ok(value === sel.value)

    await t.nextTurn()
    t.ok(false == nonSel.takeSync())
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one send and one take op that can both be performed sync, selects random op ` +
  `and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 10; ++i) {
    let chS = chan(1).named('chS')
    let chT = chan(1).named('chT')

    chT.sendSync('t')

    let sel = chan.selectSync(chS.send('s'), chT.take())
    t.ok(sel === chT || sel === chS)

    if (sel === chT) {
      t.ok(chT.value == 't')
      await t.nextTurn()
      t.ok(chS.sendSync('s') == true)
    } else {
      t.ok(chS.takeSync() == true)
      t.ok(chS.value == 's')
      await t.nextTurn()
      t.ok(chT.takeSync() == true)
    }
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`can be used to send and receive from the same chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  for (let i = 0; i < 10; ++i) {
    let ch = chan(1)

    let sel = chan.selectSync( ch.send('x'), ch.take() )
    t.ok(sel === ch)
    t.ok(ch.value === undefined)

    sel = chan.selectSync( ch.send('x'), ch.take() )
    t.ok(sel === ch)
    t.ok(ch.value === 'x')
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
for (let N = 3; N <= 7; ++N) {
////////////////////////////////////////////////////////////////////////////////////////////////////

  test(`given ${N} ops, only one of which can be performed sync, performs ` +
    `that op and returns its chan`,
  async t => {
    for (let i = 0; i < 10; ++i) {
      let ops = []
      for (let j = 1; j < N; ++j) {
        let rand = Math.random()
        let ch = new chan()
        let op; if (rand < 0.5) {
          ch.named('take')
          op = rand < 0.25 ? ch : ch.take()
        } else {
          ch.named('send')
          op = ch.send('e')
        }
        randomInsert(op, ops)
      }
      let chS = chan(1)
      let isTake = i % 2 == 0
      if (isTake) {
        chS.sendSync('x')
        randomInsert(chS.take(), ops)
      } else {
        randomInsert(chS.send('x'), ops)
      }
      let sel = chan.selectSync.apply(chan, ops)
      t.ok(sel === chS)
      if (!isTake) {
        t.ok(true == chS.takeSync())
      }
      t.ok('x' == chS.value)
      await t.nextTurn()
      for (let j = 0; j < N; ++j) {
        let op = ops[j]
        let ch = chan.isChan(op) ? op : op._chan
        if (ch === chS) continue
        if (ch.name == 'send') {
          t.ok(false == ch.takeSync())
        } else {
          t.ok(false == ch.sendSync('e'))
        }
      }
    }
  })

  for (let N_SYNC = 2; N_SYNC <= N; ++N_SYNC) {
    test(`given ${N} ops, ${N_SYNC} of which can be performed sync, performs ` +
    `random one of these sync ops and returns its chan`,
    async t => {
      for (let i = 0; i < 10; ++i) {
        let syncChans = []
        let ops = []
        let j = 0
        for (; j < N_SYNC; ++j) {
          let rand = Math.random()
          let isTake = rand < 0.5
          let ch = new chan(1).named(isTake ? `t-${j}` : `s-${j}`)
          let op; if (isTake) {
            ch.sendSync(ch.name)
            op = rand < 0.25 ? ch : ch.take()
          } else {
            op = ch.send(ch.name)
          }
          syncChans.push(ch)
          randomInsert(op, ops)
        }
        for (; j < N; ++j) {
          let ch = new chan()
          let rand = Math.random()
          let op = rand < 0.25 ? ch : rand < 0.5 ? ch.take() : ch.send('e')
          ch.named(rand < 0.5 ? 't' : 's')
          randomInsert(op, ops)
        }
        let sel = chan.selectSync.apply(chan, ops)
        t.ok(syncChans.indexOf(sel) >= 0)
        if (sel.name[0] == 's') { // send
          t.ok(true == sel.takeSync())
        }
        t.ok(sel.name == sel.value)
        await t.nextTurn()
        for (let j = 0; j < N; ++j) {
          let op = ops[j]
          let ch = chan.isChan(op) ? op : op._chan
          if (ch === sel) {
            continue
          }
          if (ch.name[0] == 's') {
            t.ok(false == ch.takeSync())
          } else {
            t.ok(false == ch.sendSync('e'))
          }
        }
      }
    })
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the op to perform gets selected randomly between those which can be performed sync`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let nAsyncOps = 5
  let nSyncSends = 2
  let nSyncTakes = 8
  let nSyncChans = nSyncSends + nSyncTakes
  let syncChans = []
  let asyncChans = []
  let syncHits = []
  let nIter = 1000

  for (let i = 0; i < nSyncSends; ++i) {
    let ch = chan(nIter).named(`s-${i}`)
    syncChans.push(ch)
    syncHits.push(0)
  }

  for (let i = 0; i < nSyncTakes; ++i) {
    let ch = chan(nIter).named(`t-${i}`)
    for (let j = 0; j < nIter; ++j) ch.sendSync(j)
    syncChans.push(ch)
    syncHits.push(0)
  }

  for (let i = 0; i < nAsyncOps; ++i) {
    let ch = chan().named(`a-${i}`)
    asyncChans.push(ch)
  }

  let indices = []

  for (let k = 0; k < nIter; ++k) {
    let i, args = []
    for (i = 0; i < nSyncSends; ++i) {
      let op = syncChans[i].send(`${k}-${i}`)
      randomInsert(op, args)
    }
    for (; i < nSyncChans; ++i) {
      let op = syncChans[i].take()
      randomInsert(op, args)
    }
    for (i = 0; i < nAsyncOps; ++i) {
      let op = (i % 2 == 0) ? asyncChans[i].send(i) : asyncChans[i].take()
      randomInsert(op, args)
    }
    let sel = chan.selectSync.apply(chan, args)
    let syncIndex = syncChans.indexOf(sel)
    if (syncIndex == -1) {
      return t.fail(`failed to select one of sync chans, selection: ${sel}`)
    }
    ++syncHits[syncIndex]
  }

  let variance = 0
  let pExp = 1 / nSyncChans

  for (let i = 0; i < nSyncChans; ++i) {
    let pi = syncHits[i] / nIter
    let di = pi - pExp
    variance += di * di
  }

  variance /= nSyncChans

  if (variance >= 0.001) {
    t.fail(`the choice of the op is not random, variance: ${ variance.toFixed(4) }`)
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`throws if the sync op that was chosen yields error (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendErrorSync(new Error(`some weird error`))
  t.throws(() => chan.selectSync( ch.take() ), /some weird error/)
})

test(`throws if the sync op that was chosen yields error (case 2)`, async t => {
  let ch1 = chan(1)
  let ch2 = chan(1)
  ch1.sendErrorSync(new Error(`some weird error`))
  t.throws(() => chan.selectSync( ch1.take(), ch2.take() ), /some weird error/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`correctly handles special chans`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  // for timeout chans interop, see tests above

  let sig = chan.signal()
  t.ok(chan.selectSync(ch, sig) === null)
  sig.trigger('ururu')
  t.ok(chan.selectSync(ch, sig) === sig)
  t.ok(sig.value == 'ururu')

  let del = chan.delay(10, 'brbrbr')
  t.ok(chan.selectSync(ch, del) === null)
  await t.sleep(200)
  t.ok(chan.selectSync(ch, del) === del)
  t.ok(del.value == 'brbrbr')

  let p = chan.fromPromise(Promise.resolve('pam-param'))
  t.ok(chan.selectSync(ch, p) === null)
  await t.nextTick()
  t.ok(chan.selectSync(ch, p) === p)
  t.ok(p.value == 'pam-param')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`ignores send-only chans`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let so = chan().sendOnly
  t.ok(chan.selectSync( so ) === null)

  let ch = chan(1)
  ch.sendSync('x')
  t.ok(chan.selectSync( so, ch ) === ch)
  t.ok(ch.value == 'x')

  t.ok(chan.selectSync( so, ch.send('y') ) === ch)
  t.ok(ch.takeSync() == true)
  t.ok(ch.value == 'y')
})
