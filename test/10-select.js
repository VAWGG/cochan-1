import {test, randomInsert} from './helpers'
import chan from '../src'

const NOT_YET = { desc: 'NOT_YET' }

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`select(...ops) yields chan.CLOSED given no arguments`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  t.is(chan.CLOSED, await chan.select())
})

test(`yields chan.CLOSED given only falsy args`, async t => {
  t.is(chan.CLOSED, await chan.select(null, false, undefined, 0))
})

test(`yields chan.CLOSED given take op from a closed chan`, async t => {
  let ch = chan()
  ch.closeNow()
  t.is(chan.CLOSED, await chan.select( ch.take() ))
  t.is(chan.CLOSED, await chan.select( ch ))
})

test(`yields chan.CLOSED given send op into a closed chan`, async t => {
  let ch = chan()
  ch.closeNow()
  t.is(chan.CLOSED, await chan.select( ch.send('e') ))
})

test(`yields chan.CLOSED given send op on a closing chan`, async t => {
  let ch = chan(1)
  ch.sendSync('x')
  ch.close()
  t.is(chan.CLOSED, await chan.select( ch.send('e') ))
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`throws given any arg that is not falsy, chan, or op`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  t.throws(() => chan.select({}), /unexpected argument/)
  t.throws(() => chan.select(true), /unexpected argument/)
  t.throws(() => chan.select('ururu'), /unexpected argument/)
  t.throws(() => chan.select(ch, {}), /unexpected argument/)
  t.throws(() => chan.select({}, ch), /unexpected argument/)
  t.throws(() => chan.select(ch, true), /unexpected argument/)
  t.throws(() => chan.select(true, ch), /unexpected argument/)
  t.throws(() => chan.select({}, true), /unexpected argument/)
})

test(`yields error given an op that was initialed not on the current tick`, async t => {
  let chX = chan(1)
  let chY = chan()

  let opSend = chX.send('x')
  let opTake = chY.take()

  await t.nextTick()

  t.throws(() => chan.select(opSend))
  t.throws(() => chan.select(chY, opSend))
  t.throws(() => chan.select(opSend, chY))
  t.throws(() => chan.select(opSend, chY.take()))
  t.throws(() => chan.select(chY.take(), opSend))

  t.throws(() => chan.select(opTake))
  t.throws(() => chan.select(chX, opTake))
  t.throws(() => chan.select(opTake, chX))
  t.throws(() => chan.select(opTake, chX.take()))
  t.throws(() => chan.select(chX.take(), opTake))

  t.throws(() => chan.select(opTake, opSend))
  t.throws(() => chan.select(opSend, opTake))
})

test(`throws error when the same op instance gets passed into two select operations`, async t => {
  let chX = chan(1)
  let chY = chan(1)
  let op = chX.send('x')

  chan.select(op)
  t.throws(() => chan.select( op, chY.send('e') ))

  await t.nextTurn()
  t.ok(false == chY.takeSync()) // chY.send('e') was not performed

  chX = chan()
  chY = chan(1)
  op = chX.take()

  chan.select(op)
  t.throws(() => chan.select( op, chY.send('e') ))

  await t.nextTurn()
  t.ok(false == chY.takeSync()) // chY.send('e') was not performed
})

test(`throws given send-only chan`, async t => {
  let so = chan().sendOnly
  t.throws(() => chan.select( so ), /send-only/)
  t.throws(() => chan.select( chan(), so ), /send-only/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one take op that can be performed sync, performs it and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendSync('x')
  t.is(ch, await chan.select( ch.take() ))
  t.ok('x' == ch.value)
})

test(`given one chan that can be taken from sync, performs take and returns the chan`, async t => {
  let ch = chan(1)
  ch.sendSync('x')
  t.is(ch, await chan.select( ch ))
  t.ok('x' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given send op on that can be performed sync, performs it and returns its chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  t.is(ch, await chan.select( ch.send('x') ))
  t.ok(true == ch.takeSync())
  t.ok('x' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
for (let N = 2; N <= 7; ++N) {
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
      let sel = await chan.select.apply(null, ops)
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

  for (let N_SYNC = 2; N_SYNC <= N; ++N_SYNC) test(`given ${N} ops, ${N_SYNC} of which can be ` +
    `performed sync, performs random one of these sync ops and returns its chan`,
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
      let sel = await chan.select.apply(null, ops)
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

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`ignores falsy args`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.closeNow()
  t.is(chan.CLOSED, await chan.select( ch.take(), null ))

  ch = chan(1)
  t.is(ch, await chan.select( null, ch.send('x'), null ))
  t.is(ch, await chan.select( null, false, undefined, 0, ch.take() ))
  t.ok('x' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one send op that cannot be performed sync, waits until it becomes available ` +
  `for execution, and then executes it`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sel = NOT_YET

  chan.select( ch.send('x') )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET === sel)

  t.ok(true === ch.takeSync())
  t.ok('x' === ch.value)

  await t.nextTick()
  t.ok(sel === ch)
})

test(`given one take op that cannot be performed sync, waits until it becomes available ` +
  `for execution, and then executes it`,
async t => {
  let ch = chan()
  let sel = NOT_YET

  chan.select( ch.take() )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET === sel)

  t.ok(true === ch.sendSync('a'))
  t.ok('a' === ch.value)

  await t.nextTick()
  t.ok(sel === ch)
})

test(`given one chan that cannot be taken from sync, waits until it can be taken from, ` +
  `and then performs the take`,
async t => {
  let ch = chan()
  let sel = NOT_YET

  chan.select( ch )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET === sel)

  await ch.send('a')
  t.ok('a' === ch.value)

  await t.nextTick()
  t.ok(sel === ch)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
for (let N = 1; N <= 2; ++N) test(`given two send ops that cannot be performed sync, performs ` +
  `the one which becomes available for execution first, and doesn't perform the ` +
  `other one (case ${N})`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chX, chY] = [chan(), chan()]
  let sel = NOT_YET

  chan.select( chX.send('x'), chY.send('y') )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET === sel)

  let [toBeSel, value, other] = N == 1
    ? [ chX, 'x', chY ]
    : [ chY, 'y', chX ]

  t.is(value, await toBeSel.take())

  await t.nextTick()
  t.ok(sel === toBeSel)

  await t.nextTurn()
  t.ok(false == other.takeSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
for (let N = 1; N <= 2; ++N) test(`given two take ops that cannot be performed sync, performs ` +
  `the one which becomes available for execution first, and doesn't perform the ` +
  `other one (case ${N})`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chX, chY] = [chan(), chan()]
  let sel = NOT_YET

  chan.select( chX.take(), chY.take() )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET === sel)

  let [toBeSel, other] = N == 1
    ? [ chX, chY ]
    : [ chY, chX ]

  t.ok(true === toBeSel.sendSync('q'))

  await t.nextTick()
  t.ok(sel === toBeSel)

  await t.nextTurn()
  t.ok(false == other.sendSync('e'))
})

////////////////////////////////////////////////////////////////////////////////////////////////////
for (let N = 1; N <= 4; ++N) test(`given one send and one take op, both of which cannot ` +
  `be performed sync, performs the one which becomes available for execution first, and ` +
  `doesn't perform the other one (case ${N})`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chT, chS] = [chan(), chan()]
  let sel = NOT_YET

  let shouldSelTake = 0 == (N - 1) % 2
  let isTakeFirst = N < 3

  let ops = isTakeFirst
    ? [ chT.take(), chS.send('q') ]
    : [ chS.send('q'), chT.take() ]

  chan.select.apply( null, ops )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET === sel)

  if (shouldSelTake) {
    t.ok(true === chT.sendSync('q'))
    await t.nextTick()
    t.ok(sel === chT)
    t.ok('q' === chT.value)
    await t.nextTurn()
    t.ok(false == chS.takeSync())
  } else {
    t.ok(true === chS.takeSync())
    t.ok('q' === chS.value)
    await t.nextTick()
    t.ok(sel === chS)
    await t.nextTurn()
    t.ok(false == chT.sendSync('e'))
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when the only chan gets closed before any op can be executed, yields chan.CLOSED (take op)`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sel = NOT_YET

  chan.select( ch.take() )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  await ch.close()
  await t.nextTurn()
  t.ok(chan.CLOSED == sel)
})

test(`when the only chan gets closed before any op can be executed, yields chan.CLOSED (send op)`,
async t => {
  let ch = chan()
  let sel = NOT_YET

  chan.select( ch.send('e') )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  ch.closeNow()
  await t.nextTurn()
  t.ok(chan.CLOSED == sel)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the fact that take op causes its chan to close doesn't make select return CLOSED`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan()
  let sel = NOT_YET
  let sent = NOT_YET

  ch.send('x').then(_ => sent = true).catch(t.fail)
  await t.nextTick()

  let pClosed = ch.close()

  chan.select( ch.take() )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTick()
  t.ok(ch == sel)
  t.ok('x' == ch.value)
  t.ok(true == sent)

  await pClosed
})

test(`the fact that chan is closed after performing send op doesn't make select return CLOSED`,
async t => {
  let ch = chan()
  let sel = NOT_YET
  let closed = false

  chan.select( ch.send('m') )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTick()
  ch.close().then(_ => closed = true).catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)
  t.ok(false == closed)

  t.ok(true == ch.takeSync())
  t.ok('m' == ch.value)
  
  await t.nextTick()
  t.ok(ch == sel)
  t.ok('m' == ch.value)
  t.ok(true == closed)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when all chans get closed before any op can be executed, yields chan.CLOSED (case 1)`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chA, chB, chC] = [chan(), chan(), chan()]
  let sel = NOT_YET

  chan.select( chA.take(), chB.send('x'), chC )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  await chA.close()
  await t.nextTurn()
  t.ok(NOT_YET == sel)

  chC.closeSync()
  await t.nextTurn()
  t.ok(NOT_YET == sel)

  chB.closeNow()
  await t.nextTick()
  t.ok(chan.CLOSED === sel)
})

test(`when all chans get closed before any op can be executed, yields chan.CLOSED (case 2)`,
async t => {
  let ch = chan()
  let sel = NOT_YET

  chan.select( ch.take(), ch.take(), ch )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  ch.closeSync()

  await t.nextTick()
  t.ok(chan.CLOSED === sel)
})

test(`when all chans get closed before any op can be executed, yields chan.CLOSED (case 3)`,
async t => {
  let [chA, chB] = [chan(), chan()]
  let sel = NOT_YET

  chA.closeSync()

  chan.select( chA.send('x'), chB.take(), chB )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  chB.closeNow()
  await t.nextTick()
  t.ok(chan.CLOSED === sel)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when only some chans get closed before some op can be executed, executes that op (case 1)`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chA, chB, chC] = [chan(), chan(), chan()]
  let sel = NOT_YET

  chan.select( chA.take(), chB.send('x'), chC )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  await chC.close()
  await t.nextTurn()
  t.ok(NOT_YET == sel)

  await chA.closeSync()
  await t.nextTurn()
  t.ok(NOT_YET == sel)

  t.ok(true == chB.takeSync())
  t.ok('x' == chB.value)

  await t.nextTick()
  t.ok(sel === chB)
})

test(`when only some chans get closed before some op can be executed, executes that op (case 2)`,
async t => {
  let [chA, chB] = [chan(), chan()]
  let sel = NOT_YET

  chan.select( chA.take(), chB.send('x'), chB.send('y') )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  chB.closeNow()
  await t.nextTurn()
  t.ok(NOT_YET == sel)

  t.ok(true == chA.sendSync('w'))
  t.ok('w' == chA.value)

  await t.nextTick()
  t.ok(sel === chA)
})

test(`when only some chans get closed before some op can be executed, executes that op (case 3)`,
async t => {
  let [chA, chB, chC] = [chan(), chan(), chan()]
  let sel = NOT_YET

  chB.closeSync()
  chC.closeSync()

  chan.select( chA.send('x'), chB.take(), chC )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTurn()
  t.ok(NOT_YET == sel)

  t.ok(true == chA.takeSync())
  t.ok('x' == chA.value)

  await t.nextTick()
  t.ok(sel === chA)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when two ops become available for execution on the same tick, executes only one of them`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chA, chB] = [chan(), chan()]
  let sel = NOT_YET

  chan.select( chA.take(), chB.take() )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTick()

  t.ok(true == chA.sendSync('a'))
  t.ok(false == chB.sendSync('b'))

  await t.nextTick()
  t.ok(chA === sel)

  await t.nextTurn()

  t.ok(false == chB.sendSync('b'))
  t.ok(false == chB.takeSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`ignores falsy args`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let [chA, chB] = [chan(), chan()]
  let sel = NOT_YET

  chan.select( null, chA.take(), 0, chB.take(), undefined, false )
    .then(ch => sel = ch)
    .catch(t.fail)

  await t.nextTick()

  t.ok(true == chA.sendSync('a'))

  await t.nextTick()
  t.ok(chA === sel)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`yields error if the op that was chosen yields error (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendErrorSync(new Error(`sync error`))
  let pSel = chan.select( ch.take() )
  await t.throws(pSel, /sync error/)
})

test(`yields error if the op that was chosen yields error (case 2)`, async t => {
  let ch = chan()
  let pSel = chan.select( ch.take() )

  await t.nextTick()
  ch.sendErrorSync(new Error(`aha!`))

  await t.throws(pSel, /aha!/)
})

test(`yields error if the op that was chosen yields error (case 3)`, async t => {
  let ch = chan()

  // monkey-patch chan to make it throw on send when active
  ch._send = (val, isError, fnVal, fnErr, needsCancelFn) => {
    fnErr(new Error(`some weird error`))
    return () => {}
  }

  let pSel = chan.select( ch.send('x') )

  await t.nextTick()
  await t.throws(pSel, /some weird error/)
})

test(`yields error given expired timeout chan`, async t => {
  let tch = chan.timeout(0)
  await t.sleep(10)
  let pSel = chan.select( chan().take(), tch.take() )
  await t.throws(pSel, /timeout/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`correctly handles special chans`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  //
  // for timeout chans interop, see tests above
  //
  let ch = chan()
  let sel = NOT_YET
  let onValue = v => sel = { value: v }
  let onError = e => sel = { error: e }

  let sig = chan.signal()
  chan.select(ch, sig).then(onValue).catch(onError)
  await t.nextTick()
  t.ok(sel === NOT_YET)
  sig.trigger('ururu')
  await t.nextTick()
  t.ok(sel.value === sig)
  t.ok(sig.value == 'ururu')
  t.is(sig, await chan.select(ch, sig))

  sel = NOT_YET

  let del = chan.delay(100, 'brbrbr')
  chan.select(ch, del).then(onValue).catch(onError)
  await t.nextTick()
  t.ok(sel === NOT_YET)
  await t.sleep(200)
  t.ok(sel.value === del)
  t.ok(del.value == 'brbrbr')
  sel = NOT_YET
  chan.select(ch, del).then(onValue).catch(onError)
  await t.sleep(200)
  t.ok(sel === NOT_YET)

  sel = NOT_YET

  let p = chan.fromPromise(t.sleep(100).then(_ => 'pam-param'))
  chan.select(ch, p).then(onValue).catch(onError)
  await t.nextTick()
  t.ok(sel === NOT_YET)
  await t.sleep(200)
  t.ok(sel.value === p)
  t.ok(p.value == 'pam-param')
  sel = NOT_YET
  chan.select(ch, del).then(onValue).catch(onError)
  await t.sleep(200)
  t.ok(sel === NOT_YET)
})
