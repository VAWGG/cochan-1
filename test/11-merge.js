import test from './helpers'
import chan from '../src'

const NOT_YET = { desc: 'NOT_YET' }

async function consume(ch, onValue) {
  let value; do {
    try {
      value = await ch.take()
    } catch (err) {
      value = err
    }
    onValue(value)
  }
  while (chan.CLOSED != value)
}

function str(v) {
  return v == chan.CLOSED ? '.' : v instanceof Error ? `(${v.message})` : String(v)
}


////////////////////////////////////////////////////////////////////////////////////////////////////
test(`chan.merge(...chans[, opts]) merges output of multiple chans into one, and closes the ` +
  `resulting chan only when all sources have closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let dst = chan()

  let srcA = chan()
  let srcB = chan()

  let m = chan.merge(srcA, srcB, { output: dst })
  let timeline = ''

  consume(m, v => timeline += str(v))

  await t.nextTurn()
  t.ok(timeline == '')

  await srcA.send('a')
  await t.nextTick()
  t.ok(timeline == 'a')

  await srcB.send('b')
  await t.nextTick()
  t.ok(timeline == 'ab')

  await srcB.send('c')
  await t.nextTick()
  t.ok(timeline == 'abc')

  await srcA.send('d')
  await t.nextTick()
  t.ok(timeline == 'abcd')

  await srcA.close()
  await t.nextTick()
  t.ok(timeline == 'abcd')

  await srcB.send('e')
  await t.nextTick()
  t.ok(timeline == 'abcde')

  await srcB.close()

  t.ok(timeline == 'abcde.')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one chan, yields the same values as the chan itself would`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let src = chan()
  let dst = chan()
  
  chan.merge(src, { output: dst })

  let timeline = ''
  consume(dst, v => timeline += str(v))

  await t.nextTurn()
  t.ok(timeline == '')

  await src.send('x')
  await t.nextTick()
  t.ok(timeline == 'x')

  await src.send('y')
  await t.nextTick()
  t.ok(timeline == 'xy')

  await src.sendError(new Error('oops'))
  await t.nextTick()
  t.ok(timeline == 'xy(oops)')

  src.closeSync()
  await t.nextTick()

  t.ok(timeline == 'xy(oops).')
})

test(`given one chan, yields the same values as the chan itself would (buffered chan)`, async t => {
  let src = chan(3)
  let dst = chan()

  src.sendSync('a')
  src.sendSync('b')
  src.sendSync('c')
  src.close()
  
  chan.merge(src, { output: dst })

  t.is('a', await dst.take())
  t.is('b', await dst.take())
  t.is('c', await dst.take())

  t.ok(dst.isClosed == true)
  t.is(chan.CLOSED, await dst.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given no chans, or only closed chans, closes dst chan right away`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let m = chan.merge({ output: chan() })
  t.ok(m.isClosed == true)

  let a = chan()
  a.closeSync()
  m = chan.merge(a, { output: chan() })
  t.ok(m.isClosed == true)

  let b = chan()
  b.closeSync()
  m = chan.merge(a, b, { output: chan() })
  t.ok(m.isClosed == true)

  let c = chan()
  c.closeSync()
  m = chan.merge(a, b, c, { output: chan() })
  t.ok(m.isClosed == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when all chans close before yielding any values, closes the output chan (case 1)`,
async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan()
  let m = chan.merge(a, { output: chan() })

  await t.nextTurn()
  t.ok(m.isClosed == false)

  a.closeSync()
  await t.nextTick()

  t.ok(m.isClosed == true)
})

test(`when all chans close before yielding any values, closes the output chan (case 2)`,
async t => {
  let a = chan(0)
  let b = chan(1)
  let c = chan(1)

  a.closeSync()
  b.sendSync('b')

  let m = chan.merge(a, b, c, { output: chan() })

  t.is('b', await m.take())
  t.ok(m.isClosed == false)

  c.sendSync('c')
  await b.close()
  t.is('c', await m.take())
  t.ok(m.isClosed == false)

  await c.close()
  t.ok(m.isClosed == true)
  t.is(chan.CLOSED, await m.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`doesn't consume anything until output can receive data (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let src = chan(3)
  
  src.sendSync('a')
  src.sendSync('b')
  src.sendSync('c')

  let m = chan.merge(src, { output: chan() })
  await t.nextTurn()

  t.ok(src.canTakeSync && src.takeSync() && src.value == 'a')
  t.ok(src.canTakeSync && src.takeSync() && src.value == 'b')
  t.ok(src.canTakeSync && src.takeSync() && src.value == 'c')
})

test(`doesn't consume anything until output can receive data (case 2)`, async t => {
  let src = chan(4)
  
  src.sendSync('a')
  src.sendSync('b')
  src.sendSync('c')
  src.sendSync('d')
  src.close()

  let m = chan.merge(src, { output: chan() })
  
  t.is('a', await m.take())
  t.ok(src.canTakeSync && src.takeSync() && src.value == 'b')

  t.is('c', await m.take())
  t.ok(src.canTakeSync && src.takeSync() && src.value == 'd')

  t.ok(src.isClosed == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`stops consuming values when output gets closed (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendSync('x')
  ch.close()

  let m = chan.merge(ch, { output: chan() })
  t.ok(m.closeSync() == true)

  await t.nextTurn()
  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(ch.isClosed == true)
})

test(`stops consuming values when output gets closed (case 2)`, async t => {
  let ch = chan(2)

  ch.sendSync('x')
  ch.sendSync('y')

  let m = chan.merge(ch, { output: chan(1) })
  m.closeNow()

  await t.nextTurn()
  t.ok(ch.takeSync() && ch.value == 'y')
})

test(`stops consuming values when output gets closed (case 3)`, async t => {
  let ch = chan(1)
  ch.sendSync('x')

  let tm = chan.timeout(10)
  await t.sleep(11)

  let m = chan.merge(ch, tm, { output: chan() })
  t.ok(m.closeSync() == true)

  await t.nextTurn()
  t.ok(ch.takeSync() && ch.value == 'x')
})

test(`is nop when output is closed at time of the call`, async t => {
  let dst = chan()
  dst.closeSync()

  let ch1 = chan(1)
  ch1.sendSync('x')

  let ch2 = chan(1)
  ch2.sendSync('y')

  let m = chan.merge(ch1, ch2, { output: dst })
  await t.nextTurn()

  t.ok(ch1.takeSync() && ch1.value == 'x')
  t.ok(ch2.takeSync() && ch2.value == 'y')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test.skip(`allows consuming values synchronously`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(3)

  a.sendSync('a1')
  a.sendSync('a2')
  a.sendSync('a3')

  let m = chan.merge(a, { output: chan() })

  t.ok(m.canTakeSync && m.takeSync() && m.value == 'a1')
  t.ok(m.canTakeSync && m.takeSync() && m.value == 'a2')
  t.ok(m.canTakeSync && m.takeSync() && m.value == 'a3')
  t.ok(m.canTakeSync == false && m.takeSync() == false)

  a.sendSync('a4')
  a.sendSync('a5')

  t.ok(m.canTakeSync && m.takeSync() && m.value == 'a4')
  t.ok(m.canTakeSync && m.takeSync() && m.value == 'a5')
  t.ok(m.canTakeSync == false && m.takeSync() == false)

  a = chan(3)
  let b = chan()
  m = chan.merge(a, b, { output: chan() })

  b.send('b1')
  b.send('b2')
  await t.nextTick()

  t.ok(m.canTakeSync && m.takeSync() && m.value == 'b1')
  t.ok(m.canTakeSync && m.takeSync() && m.value == 'b2')
  t.ok(m.canTakeSync == false && m.takeSync() == false)

  a.sendSync('a')
  a.sendSync('a')
  b.send('b')
  b.send('b')
  await t.nextTick()

  t.ok(m.canTakeSync && m.takeSync() && (m.value == 'a' || m.value == 'b'))
  t.ok(m.canTakeSync && m.takeSync() && (m.value == 'a' || m.value == 'b'))
  t.ok(m.canTakeSync && m.takeSync() && (m.value == 'a' || m.value == 'b'))
  t.ok(m.canTakeSync && m.takeSync() && (m.value == 'a' || m.value == 'b'))
  t.ok(m.canTakeSync == false && m.takeSync() == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when multiple chans have values, selects the chan to perform take from randomly (async take)`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
//// TODO: use approx. entropy calculation algorithm from this paper: http://arxiv.org/abs/1305.0954
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(30)
  let b = chan(30)

  for (let i = 0; i < 30; ++i) {
    a.sendSync('a')
    b.sendSync('b')
  }

  let m = chan.merge(a, b, { output: chan() })
  let ctr = 0

  for (let i = 0; i < 30; ++i) {
    switch (await m.take()) {
      case 'a': ++ctr; break
      case 'b': --ctr; break
      default: return t.fail(`unexpected value: ${ m.value }`)
    }
  }

  t.ok(Math.abs(ctr) < 20)
})

test.skip(`when multiple chans have values, selects the chan to perform take from randomly (sync take)`,
async t => {
  let a = chan(30)
  let b = chan(30)

  for (let i = 0; i < 30; ++i) {
    a.sendSync('a')
    b.sendSync('b')
  }

  let m = chan.merge(a, b, { output: chan() })
  let ctr = 0

  for (let i = 0; i < 30; ++i) {
    m.takeSync(); switch (m.value) {
      case 'a': ++ctr; break
      case 'b': --ctr; break
      default: return t.fail(`unexpected value: ${ m.value }`)
    }
  }

  t.ok(Math.abs(ctr) < 20)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`performs as much ops as possible synchronously (one input chan)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let inp = chan()
  let sent = ''

  inp.send('a').then(v => sent += v)
  inp.send('b').then(v => sent += v)
  inp.send('c').then(v => sent += v)

  let m = chan.merge(inp, { output: chan(2) })

  await t.nextTick()
  t.ok(sent == 'ab')

  t.ok(m.takeSync() == true && m.value == 'a')

  await t.nextTick()
  t.ok(sent == 'abc')

  t.ok(m.takeSync() == true && m.value == 'b')
  t.ok(m.takeSync() == true && m.value == 'c')
  t.ok(m.canTakeSync == false)

  inp.send('d').then(v => sent += v)
  inp.send('e').then(v => sent += v)

  await t.nextTick()
  t.ok(sent == 'abcde')

  inp.close().then(_ => sent += '.')

  await t.nextTick()
  t.ok(sent == 'abcde.')

  t.ok(m.takeSync() == true && m.value == 'd')
  t.ok(m.takeSync() == true && m.value == 'e')
  t.ok(m.isClosed == true)
})

test(`performs as much ops as possible synchronously (one input chan, buffered)`, async t => {
  let inp = chan(3)
  
  inp.sendSync('a')
  inp.sendSync('b')
  inp.sendSync('c')

  let m = chan.merge(inp, { output: chan(1) })

  t.ok(m.takeSync() == true && m.value == 'a')
  t.ok(m.takeSync() == true && m.value == 'b')
  t.ok(m.takeSync() == true && m.value == 'c')
  t.ok(m.canTakeSync == false)

  inp.sendSync('d')
  inp.sendSync('e')
  inp.close()

  t.ok(m.takeSync() == true && m.value == 'd')
  t.ok(m.takeSync() == true && m.value == 'e')
  t.ok(m.isClosed == true)
})

test(`performs as much ops as possible synchronously (multiple chans, case 1)`, async t => {
  let a = chan(2)
  let b = chan(2)

  a.sendSync('a-1')
  a.sendSync('a-2')

  let m = chan.merge(a, b, { output: chan(2) })

  t.ok(m.takeSync() == true && m.value == 'a-1')
  t.ok(m.takeSync() == true && m.value == 'a-2')
  t.ok(m.takeSync() == false)

  b.sendSync('b-1')
  b.sendSync('b-2')
  b.sendSync('b-3')

  t.ok(m.takeSync() == true && m.value == 'b-1')
  t.ok(m.takeSync() == true && m.value == 'b-2')
  t.ok(m.takeSync() == true && m.value == 'b-3')
  t.ok(m.takeSync() == false)

  a.sendSync('a-3') // these should be merged in order, as the output is buffered,
  b.sendSync('b-4') // and buffer is empty, so merge should take and send them as
  a.sendSync('a-4') // soon as it sees that it can take synchronously

  t.ok(m.takeSync() == true && m.value == 'a-3')
  t.ok(m.takeSync() == true && m.value == 'b-4')
  t.ok(m.takeSync() == true && m.value == 'a-4')
  t.ok(m.takeSync() == false)

  a.sendSync('a-5')
  b.sendSync('b-5')

  a.close()
  b.close()

  t.ok(m.takeSync() == true && m.value == 'a-5')
  t.ok(m.takeSync() == true && m.value == 'b-5')
  t.ok(m.isClosed == true)
})

test(`performs as much ops as possible synchronously (multiple chans, case 2)`, async t => {
  let a = chan(1)
  let b = chan(2)
  let c = chan(3)

  a.sendSync('a-1')
  b.sendSync('b-1')
  b.sendSync('b-2')
  c.sendSync('c-1')
  c.sendSync('c-2')
  c.sendSync('c-3')

  a.close()
  b.close()
  c.close()

  let m = chan.merge(a, b, c, { output: chan(6) })

  t.ok(a.isClosed == true && b.isClosed == true && c.isClosed == true)

  let values = []; for (let i = 0; i < 6; ++i) {
    t.ok(m.takeSync() == true)
    values.push(m.value)
  }

  ['a-1', 'b-1', 'b-2', 'c-1', 'c-2', 'c-3'].forEach(v => {
    t.ok(values.indexOf(v) >= 0)
  })
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when any timeout chan becomes expired, starts yielding errors (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tm = chan.timeout(100)
  let ch = chan(2)
  let m = chan.merge(ch, tm, { output: chan() })

  ch.sendSync('x')
  ch.sendSync('y')

  t.is('x', await m.take())

  await t.sleep(101)

  for (let i = 0; i < 10; ++i) {
    await t.throws(m.take(), /timeout/)
  }
})

test(`when any timeout chan becomes expired, starts yielding errors (multiple timeouts, case 1)`,
async t => {
  let tm1 = chan.timeout(200)
  let tm2 = chan.timeout(100, `ururu`)
  let ch = chan(2)
  let m = chan.merge(ch, tm1, tm2, { output: chan() })

  ch.sendSync('x')
  ch.sendSync('y')

  t.is('x', await m.take())

  await t.sleep(101)

  for (let i = 0; i < 10; ++i) {
    await t.throws(m.take(), /ururu/)
  }
})

test(`when any timeout chan becomes expired, starts yielding errors (case 2)`, async t => {
  let tm = chan.timeout(100)
  let ch = chan()
  let m = chan.merge(ch, tm, { output: chan() })

  let recv = NOT_YET
  m.take().then(v => recv = { value: v }).catch(e => recv = { error: e })

  await t.sleep(99)
  t.ok(recv == NOT_YET)

  await t.sleep(1)
  t.ok(recv && recv.error instanceof Error && /timeout/.test(recv.error.message))

  for (let i = 0; i < 10; ++i) {
    await t.throws(m.take(), /timeout/)
  }
})

test(`when any timeout chan becomes expired, starts yielding errors (multiple timeouts, case 2)`,
async t => {
  let tm1 = chan.timeout(200)
  let tm2 = chan.timeout(100, 'ururu')
  let ch = chan()
  let m = chan.merge(ch, tm1, tm2, { output: chan() })

  let recv = NOT_YET
  m.take().then(v => recv = { value: v }).catch(e => recv = { error: e })

  await t.sleep(99)
  t.ok(recv == NOT_YET)

  await t.sleep(1)
  t.ok(recv && recv.error instanceof Error && /ururu/.test(recv.error.message))

  for (let i = 0; i < 10; ++i) {
    await t.throws(m.take(), /ururu/)
  }
})

test.skip(`when any timeout chan becomes expired, starts yielding errors (sync take)`, async t => {
  let tm = chan.timeout(100)
  let ch = chan(2)
  let m = chan.merge(ch, tm, { output: chan() })

  ch.sendSync('x')
  await t.sleep(101)

  for (let i = 0; i < 10; ++i) {
    t.throws(() => m.takeSync(), /timeout/)
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when any of the chans are expired timeout chans, yields error`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tm = chan.timeout(10, `out of vodka`)
  let ch = chan()
  let chBuf = chan(2)
  chBuf.sendSync('x')

  await t.sleep(10)

  let m1 = chan.merge(tm, { output: chan() })
  await t.throws(m1.take(), /out of vodka/)

  let m2 = chan.merge(tm, ch)
  await t.throws(m2.take(), /out of vodka/)

  let m3 = chan.merge(ch, tm)
  await t.throws(m3.take(), /out of vodka/)

  let m4 = chan.merge(tm, chBuf)
  await t.throws(m4.take(), /out of vodka/)

  let m5 = chan.merge(chBuf, tm)
  await t.throws(m5.take(), /out of vodka/)

  let m6 = chan.merge(chBuf, ch, tm)
  await t.throws(m6.take(), /out of vodka/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when output option is not specified, creates a take-only merge channel`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(0)
  let b = chan(1)
  let m = chan.merge(a, b)

  t.ok(chan.isChan(m))
  t.ok(m.toString() == '[<-]chan.merge(chan(0), chan(1))')

  let timeline = ''
  consume(m, v => timeline += str(v))

  t.ok(m.canSend == false)
  t.ok(m.canSendSync == false)

  t.throws(() => m.send('x'), /take-only/)
  t.throws(() => m.sendSync('x'), /take-only/)
  t.throws(() => m.close(), /take-only/)
  t.throws(() => m.closeSync(), /take-only/)

  await a.send('x')
  b.sendSync('y')

  await t.nextTick()

  t.ok(timeline == 'xy')
})
