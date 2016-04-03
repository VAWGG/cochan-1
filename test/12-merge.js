import test from './helpers'
import chan from '../src'
import stream from 'readable-stream'

const NOT_YET = { desc: 'NOT_YET' }

function str(v) {
  return v == chan.CLOSED ? '.' : v instanceof Error ? `(${v.message})` : String(v)
}

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`chan.merge(...chans[, opts]) creates special merge channel`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(0).named('A')
  let b = chan(1).named('B')
  let T = chan.timeout(1000)
  let m = chan.merge(a, b, T)

  t.ok(chan.isChan(m) == true)
  t.ok(m.toString() == 'chan.merge(chan<A>(0), chan<B>(1), chan.timeout(1000))')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`merge channel cannot be sent or piped into`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let m = chan.merge( chan(1) )

  t.ok(m.canSend == false)
  t.ok(m.canSendSync == false)

  t.throws(() => m.sendSync('x'), /not supported/)
  t.throws(() => m.sendErrorSync('x'), /not supported/)

  t.throws(() => m.send('x'), /not supported/)
  t.throws(() => m.sendError('x'), /not supported/)
  t.throws(() => m.sendNow('x'), /not supported/)
  t.throws(() => m.sendErrorNow('x'), /not supported/)

  t.throws(() => m.write('x'), /not supported/)
  t.throws(() => m.end('x'), /not supported/)

  let s = new stream.PassThrough()
  t.throws(() => s.pipe(m), /not supported/)

  // internal api
  t.throws(() => m._sendSync('x', 0), /not supported/)
  t.throws(() => m._send('x', 0, t.nop, t.nop, false), /not supported/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanSendSync() always resolves as fast as possible`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.merge( chan() )
  let resolvedWith

  resolvedWith = NOT_YET
  ch.maybeCanSendSync().then(v => resolvedWith = v).catch(t.fail)
  await t.nextTick()
  t.ok(resolvedWith == true)

  resolvedWith = NOT_YET
  ch.closeNow()
  ch.maybeCanSendSync().then(v => resolvedWith = v).catch(t.fail)
  await t.nextTick()
  t.ok(resolvedWith == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`merges output of multiple chans into one, and closes the resulting chan only when ` +
  `all sources have closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let srcA = chan()
  let srcB = chan()
  let m = chan.merge(srcA, srcB)

  let timeline = ''; let takeNext = async () => {
    m.take().then(v => timeline += str(v)).catch(t.fail)
    await t.nextTick()
  }

  await takeNext()
  await t.sleep(100)
  t.ok(timeline == '')

  t.ok(srcA.sendSync('a'))
  await t.nextTick()
  t.ok(timeline == 'a')

  await takeNext()
  t.ok(srcB.sendSync('b'))
  await t.nextTick()
  t.ok(timeline == 'ab')

  takeNext() // no await, so at this point take is not actually performed yet
  t.ok(srcB.sendSync('c') == false)
  srcB.sendNow('c')
  await t.nextTick()
  t.ok(timeline == 'abc')

  await takeNext()
  t.ok(srcA.sendSync('d'))
  await t.nextTick()
  t.ok(timeline == 'abcd')

  await srcA.close()
  await t.nextTick()
  t.ok(timeline == 'abcd')

  await takeNext()
  t.ok(srcB.sendSync('e'))
  await t.nextTick()
  t.ok(timeline == 'abcde')

  await takeNext()
  await srcB.close()

  t.ok(timeline == 'abcde.')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given one chan, yields the same values as the chan itself would`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let src = chan()
  let m = chan.merge(src)

  let timeline = ''; let takeNext = async () => {
    let onValue = v => timeline += str(v)
    m.take().then(onValue, onValue)
    await t.nextTick()
  }

  await takeNext()
  await t.sleep(100)
  t.ok(timeline == '')

  t.ok(src.sendSync('x'))
  await t.nextTick()
  t.ok(timeline == 'x')

  takeNext() // no await, so at this point take is not actually performed yet
  t.ok(src.sendSync('y') == false)
  src.sendNow('y')
  await t.nextTick()
  t.ok(timeline == 'xy')

  await takeNext()
  t.ok(src.sendErrorSync(new Error('oops')))
  await t.nextTick()
  t.ok(timeline == 'xy(oops)')

  await takeNext()
  src.closeSync()
  await t.nextTick()
  t.ok(timeline == 'xy(oops).')
})

test(`given one chan, yields the same values as the chan itself would (buffered chan)`, async t => {
  let src = chan(3)

  src.sendSync('a')
  src.sendSync('b')
  src.sendSync('c')
  src.close()
  
  let m = chan.merge(src)

  t.is('a', await m.take())
  t.is('b', await m.take())
  t.is('c', await m.take())

  t.ok(m.isClosed == true)
  t.is(chan.CLOSED, await m.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given no chans, or only closed chans, closes dst chan right away`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let m = chan.merge()
  t.ok(m.isClosed == true)

  let a = chan()
  a.closeSync()
  m = chan.merge(a)
  t.ok(m.isClosed == true)

  let b = chan()
  b.closeSync()
  m = chan.merge(a, b)
  t.ok(m.isClosed == true)

  let c = chan()
  c.closeSync()
  m = chan.merge(a, b, c)
  t.ok(m.isClosed == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when all chans close before yielding any values, closes the output chan (case 1)`,
async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan()
  let m = chan.merge(a)

  await t.sleep(100)
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

  let m = chan.merge(a, b, c)

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

  let m = chan.merge(src)
  await t.sleep(100)

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

  let m = chan.merge(src)
  
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

  let m = chan.merge(ch)
  t.ok(m.closeSync() == true)

  await t.nextTurn()
  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(ch.isClosed == true)
})

test(`stops consuming values when output gets closed (case 2)`, async t => {
  let ch = chan(2)

  ch.sendSync('x')
  ch.sendSync('y')

  let m = chan.merge(ch, { bufferSize: 1 })
  m.closeNow()

  await t.nextTurn()
  t.ok(ch.takeSync() && ch.value == 'y')
})

test(`stops consuming values when output gets closed (case 3)`, async t => {
  let ch = chan(1)
  ch.sendSync('x')

  let tm = chan.timeout(10)
  await t.sleep(11)

  let m = chan.merge(ch, tm)
  t.ok(m.closeSync() == true)

  await t.nextTurn()
  t.ok(ch.takeSync() && ch.value == 'x')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows consuming values synchronously`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(3)

  a.sendSync('a1')
  a.sendSync('a2')
  a.sendSync('a3')

  let m = chan.merge(a)

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
  m = chan.merge(a, b)

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

  let m = chan.merge(a, b)
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

test(`when multiple chans have values, selects the chan to perform take from randomly (sync take)`,
async t => {
  let a = chan(30)
  let b = chan(30)

  for (let i = 0; i < 30; ++i) {
    a.sendSync('a')
    b.sendSync('b')
  }

  let m = chan.merge(a, b)
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
test(`canTakeSync and takeSync behave properly when the output is buffered`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(1)
  let b = chan(1)
  let m = chan.merge(a, b, { bufferSize: 1 })

  t.ok(m.canTakeSync == false)

  t.ok(a.sendSync('a-1')) // a-1 is buffered inside m
  t.ok(m.canTakeSync == true && a.canTakeSync == false)

  t.ok(b.sendSync('b-1')) // b-1 is not buffered inside m yet
  t.ok(m.canTakeSync == true && b.canTakeSync == true)

  t.ok(m.takeSync() && m.value == 'a-1') // b-1 gets buffered inside m
  t.ok(m.canTakeSync == true && b.canTakeSync == false)

  t.ok(a.sendSync('a-2')) // a-2 is not buffered inside m yet
  t.ok(m.canTakeSync == true && a.canTakeSync == true)

  t.ok(b.sendSync('b-2')) // b-2 is not buffered inside m yet
  t.ok(m.canTakeSync == true && b.canTakeSync == true)

  t.ok(m.takeSync() && m.value == 'b-1')
  // at this point, either a-2 or b-2 (random choice) gets buffered inside m

  let values = []

  t.ok(m.takeSync() == true); values.push(m.value)
  t.ok(m.takeSync() == true); values.push(m.value)
  t.ok(m.canTakeSync == false)

  t.ok(values && values.indexOf('a-2') >= 0 && values.indexOf('b-2') >= 0)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`performs as much ops as possible synchronously (one input chan)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let inp = chan()
  let sent = ''

  inp.send('a').then(v => sent += v)
  inp.send('b').then(v => sent += v)
  inp.send('c').then(v => sent += v)

  let m = chan.merge(inp, { bufferSize: 2 })

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

  let m = chan.merge(inp, { bufferSize: 1 })

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

  let m = chan.merge(a, b, { bufferSize: 2 })

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

  let m = chan.merge(a, b, c, { bufferSize: 6 })

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
test(`#maybeCanTakeSync() triggers when one of the merged channels becomes available ` +
  `for sync take`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan()
  let b = chan()
  let m = chan.merge(a, b)

  let events, maybeCanTakeSync = () => {
    events = ''
    m.maybeCanTakeSync().then(v => events += `M(${v})`).catch(t.fail)
  }

  maybeCanTakeSync()
  await t.nextTurn()
  t.ok(events == '')

  b.sendNow('x')
  await t.nextTick()
  t.ok(events == 'M(true)')
})

test(`#maybeCanTakeSync() doesn't trigger when the value gets immediately consumed by ` +
  `the merge (non-buffered output)`,
async t => {
  let a = chan()
  let b = chan()
  let m = chan.merge(a, b)

  let events = ''

  m.maybeCanTakeSync().then(v => events += `M(${v})`).catch(t.fail)

  m.take().then(v => events += `T(${v})`).catch(t.fail)
  await t.nextTick()

  t.ok(a.sendSync('x'))
  await t.nextTick()
  t.ok(events == 'T(x)')

  await t.sleep(100)
  t.ok(events == 'T(x)')
})

test(`#maybeCanTakeSync() triggers when the value gets buffered inside the merge channel`,
async t => {
  let a = chan()
  let b = chan()
  let m = chan.merge(a, b, { bufferSize: 1 })

  let events = ''
  m.maybeCanTakeSync().then(v => events += `M(${v})`).catch(t.fail)

  t.ok(a.sendSync('x'))
  await t.nextTick()
  t.ok(events == 'M(true)')
})

test(`#maybeCanTakeSync() propagates to the upstream channels`, async t => {
  let a = chan()
  let b = chan()

  let maybeCanSendSyncA = NOT_YET
  let maybeCanSendSyncB = NOT_YET

  a.maybeCanSendSync().then(v => maybeCanSendSyncA = v).catch(t.fail)
  b.maybeCanSendSync().then(v => maybeCanSendSyncB = v).catch(t.fail)

  let m = chan.merge(a, b)

  await t.nextTurn()
  t.ok(maybeCanSendSyncA === NOT_YET && maybeCanSendSyncB === NOT_YET)

  let maybeCanTakeSync = NOT_YET
  m.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTick()
  t.ok(maybeCanSendSyncA == true && maybeCanSendSyncB == true)
  t.ok(maybeCanTakeSync === NOT_YET)

  await t.sleep(100)
  t.ok(maybeCanTakeSync === NOT_YET)
})

test(`#maybeCanTakeSync() triggers as fast as possible when the merge chan is available ` +
  `for sync take at the time of the call (non-buffered output)`,
async t => {
  let ch = chan(1)
  ch.sendNow('x')

  let m = chan.merge(ch)

  let maybeCanTakeSync = NOT_YET
  m.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTick()
  t.ok(maybeCanTakeSync == true)
})

test(`#maybeCanTakeSync() triggers as fast as possible when the merge chan is available ` +
  `for sync take at the time of the call (buffered output)`,
async t => {
  let ch = chan(1)
  ch.sendNow('x')

  let m = chan.merge(ch, { bufferSize: 1 })

  let maybeCanTakeSync = NOT_YET
  m.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTick()
  t.ok(maybeCanTakeSync == true)
})

test(`#maybeCanTakeSync() triggers false response when the merge chan gets closed`,
async t => {
  let m = chan.merge( chan() )

  let maybeCanTakeSync = NOT_YET
  m.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanTakeSync === NOT_YET)

  m.closeNow()
  await t.nextTick()
  t.ok(maybeCanTakeSync == false)
})

test(`#maybeCanTakeSync() triggers false response as fast as possible when the merge chan ` +
  `is closed at the time of the call`,
async t => {
  let m = chan.merge( chan() )
  m.closeNow()

  let maybeCanTakeSync = NOT_YET
  m.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTick()
  t.ok(maybeCanTakeSync == false)
})

test(`(internal) #_maybeCanTakeSync() callback gets called synchronously, and no more than once`,
async t => {
  let a = chan(1)
  let b = chan(1)
  let m = chan.merge(a, b, { bufferSize: 1 })

  let events = ''
  m._maybeCanTakeSync(v => events += `M(${v})`, false)

  await t.sleep(100)
  t.ok(events == '')

  t.ok(a.sendSync('a-1'))
  t.ok(events == 'M(true)')

  t.ok(a.sendSync('a-2'))
  t.ok(events == 'M(true)')

  t.ok(b.sendSync('b-1'))
  t.ok(events == 'M(true)')

  b.sendNow('b-2')
  t.ok(events == 'M(true)')

  await t.sleep(100)
  t.ok(events == 'M(true)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when any timeout chan becomes expired, starts yielding errors (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tm = chan.timeout(100)
  let ch = chan(2)
  let m = chan.merge(ch, tm)

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
  let m = chan.merge(ch, tm1, tm2)

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
  let m = chan.merge(ch, tm)

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
  let m = chan.merge(ch, tm1, tm2)

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

test(`when any timeout chan becomes expired, starts yielding errors (sync take)`, async t => {
  let tm = chan.timeout(100)
  let ch = chan(2)
  let m = chan.merge(ch, tm)

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

  let m1 = chan.merge(tm)
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
test(`can be closed, which stops merging right now (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan(1)
  let b = chan(1)

  t.ok(a.sendSync('a'))
  t.ok(b.sendSync('b'))

  let m = chan.merge(a, b)
  t.ok(m.isClosed == false && m.isActive == true && m.canTakeSync == true)

  t.ok(m.closeSync())
  t.ok(m.isClosed == true && m.isActive == false && m.canTakeSync == false)
  t.is(chan.CLOSED, await m.take())

  t.ok(a.takeSync() && a.value == 'a')
  t.ok(b.takeSync() && b.value == 'b')

  t.is(chan.CLOSED, await m.take())
})

test(`can be closed, which stops merging right now (case 2)`, async t => {
  let a = chan(1)
  let b = chan(1)

  t.ok(a.sendSync('a-1'))

  let m = chan.merge(a, b)
  t.ok(m.isClosed == false && m.isActive == true)

  t.ok(m.takeSync() && m.value == 'a-1')

  t.ok(a.sendSync('a-2'))
  t.ok(b.sendSync('b-1'))

  t.ok(m.closeSync())
  t.ok(m.isClosed == true && m.isActive == false && m.canTakeSync == false)
  t.is(chan.CLOSED, await m.take())

  t.ok(a.takeSync() && a.value == 'a-2')
  t.ok(b.takeSync() && b.value == 'b-1')

  t.is(chan.CLOSED, await m.take())
})

test(`can be closed, which stops merging right now (case 3)`, async t => {
  let a = chan(1)
  let T = chan.timeout(42)

  let m = chan.merge(a, T)
  t.ok(m.isClosed == false && m.isActive == true)

  t.ok(m.closeSync())
  t.ok(m.isClosed == true && m.isActive == false && m.canTakeSync == false)
  t.is(chan.CLOSED, await m.take())

  await t.sleep(53)

  t.ok(m.isClosed == true && m.isActive == false && m.canTakeSync == false)
  t.is(chan.CLOSED, await m.take())
})

test(`can be closed, which stops merging right now (case 4)`, async t => {
  let a = chan()
  let b = chan()

  let m = chan.merge(a, b)
  t.ok(m.isClosed == false && m.isActive == true)

  let recv = NOT_YET
  m.take().then(v => recv = v).catch(t.fail)
  await t.nextTick()

  m.close()
  t.ok(m.isClosed == true && m.isActive == false)
  t.is(chan.CLOSED, await m.take())
  t.ok(recv === chan.CLOSED)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`can be composed (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let a = chan().named('a')
  let b = chan.merge(a).named('b')
  let c = chan.merge(b).named('c')
  let d = chan.merge(c).named('d')

  let recv = NOT_YET
  d.take().then(v => recv = v).catch(t.fail)

  await t.nextTurn()
  t.ok(recv === NOT_YET)

  let sent = NOT_YET
  a.sendNow('x')

  await t.nextTick()
  t.ok(recv == 'x')

  let maybeCanSendToA = NOT_YET
  a.maybeCanSendSync().then(v => maybeCanSendToA = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanSendToA === NOT_YET)

  let maybeCanTakeFromD = NOT_YET
  d.maybeCanTakeSync().then(v => maybeCanTakeFromD = v).catch(t.fail)
  
  await t.nextTurn()
  t.ok(maybeCanSendToA == true)
  t.ok(maybeCanTakeFromD === NOT_YET)

  a.sendNow('y')
  await t.nextTurn()
  t.ok(maybeCanTakeFromD == true)

  a.closeNow()

  t.ok(b.isClosed == true)
  t.ok(c.isClosed == true)
  t.ok(d.isClosed == true)
})

test(`can be composed (case 2)`, async t => {
  let a = chan.timeout(100).named('a')
  let b = chan.merge(a).named('b')
  let c = chan.merge(b).named('c')

  let recv = NOT_YET
  c.take().then(value => recv = {value}).catch(error => recv = {error})

  await t.nextTurn()
  t.ok(recv === NOT_YET)

  await t.sleep(50)
  t.ok(recv === NOT_YET)

  await t.sleep(50)
  t.ok(recv && recv.error && /timeout/.test(recv.error.message))

  await t.throws(c.take(), /timeout/)
  await t.throws(c.take(), /timeout/)
  await t.throws(c.take(), /timeout/)

  t.ok(b.closeSync() == true)
  t.ok(c.isClosed == true)
})

test(`can be composed (case 3)`, async t => {
  let a = chan(2).named('a')
  let m_inner = chan.merge(a).named('m_inner')

  let b = chan(2).named('b')
  let m = chan.merge(m_inner, b).named('m')

  let recv = NOT_YET
  m.take().then(v => recv = v).catch(t.fail)
  await t.nextTick()

  await b.send('x')
  t.ok(recv == 'x')

  a.send('e') // should not cause (async) assertion error
  await t.sleep(100)
})

test(`can be composed (case 4)`, async t => {
  let a = chan(2)
  let b = chan(2)
  let T = chan.timeout(1000)
  let m1 = chan.merge(a, b, T)

  let c = chan(2)
  let m2 = chan.merge(m1, c)

  let d = chan()
  let m = chan.merge(d, m2)

  a.sendSync('a-0')
  a.sendSync('a-1')

  b.sendSync('b-0')
  b.sendSync('b-1')

  c.sendSync('c-0')
  c.sendSync('c-1')

  d.sendNow('d-0')
  d.sendNow('d-1')

  await t.nextTurn()

  t.ok(a.takeSync() && a.value == 'a-0')
  t.ok(b.takeSync() && b.value == 'b-0')
  t.ok(c.takeSync() && c.value == 'c-0')
  t.ok(d.takeSync() && d.value == 'd-0')

  let values = []

  t.ok(m.takeSync() == true); values.push(m.value)
  t.ok(m.takeSync() == true); values.push(m.value)
  t.ok(m.takeSync() == true); values.push(m.value)
  t.ok(m.takeSync() == true); values.push(m.value)

  for (let v of [ 'a-1', 'b-1', 'c-1', 'd-1' ]) {
    t.ok(values.indexOf(v) >= 0)
  }

  b.sendSync('b-2')
  t.ok(m.takeSync() && m.value == 'b-2')

  d.sendNow('d-2')
  t.ok(m.takeSync() && m.value == 'd-2')

  c.sendNow('c-2')
  t.ok(m.takeSync() && m.value == 'c-2')

  let recv = NOT_YET
  m.take().then(v => recv = v).catch(t.fail)

  await t.nextTurn()
  t.ok(recv === NOT_YET)

  await a.send('a-2')
  t.ok(recv === 'a-2')

  recv = NOT_YET
  m.take().then(v => recv = v).catch(t.fail)

  await b.send('b-3')
  t.ok(recv === 'b-3')

  recv = NOT_YET
  m.take().then(v => recv = v).catch(t.fail)

  await c.send('c-3')
  t.ok(recv === 'c-3')

  recv = NOT_YET
  m.take().then(v => recv = v).catch(t.fail)

  await d.send('d-3')
  t.ok(recv === 'd-3')

  a.sendNow('a-3')
  d.sendNow('d-4')
  b.sendNow('b-4')
  c.sendNow('c-4')

  values = []

  m.take().then(v => values.push(v)).catch(t.fail)
  m.take().then(v => values.push(v)).catch(t.fail)
  m.take().then(v => values.push(v)).catch(t.fail)
  m.take().then(v => values.push(v)).catch(t.fail)

  await t.nextTick()
  t.ok(values.length == 4)

  for (let v of [ 'a-3', 'b-4', 'c-4', 'd-4' ]) {
    t.ok(values.indexOf(v) >= 0)
  }

  await a.close()
  t.ok(m.isClosed == false)

  await b.close()
  t.ok(m.isClosed == false)

  await c.close()
  t.ok(m.isClosed == false)

  await d.close()
  t.ok(m.isClosed == false)

  await t.sleep(1000)
  t.ok(m.isClosed == false)

  await t.throws(m.take(), /timeout/)
  await t.throws(m.take(), /timeout/)
  await t.throws(m.take(), /timeout/)
})
