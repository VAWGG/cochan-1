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
test(`doesn't consume anything until output can receive data`, async t => {
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

test.todo(`when any of the chans are expired timeout chans, yields error`)
test.todo(`respects backpressure generated by the output chan`)

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
