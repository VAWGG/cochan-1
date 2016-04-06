import test from './helpers'
import chan from '../src'

const NOT_YET = { desc: 'NOT_YET' }


////////////////////////////////////////////////////////////////////////////////////////////////////
test(`chan.delay(ms[, value]) creates a special delay chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)
  t.ok(chan.isChan(ch))
  t.ok(ch.toString() == 'chan.delay(100)')

  ch = chan.delay(100, 500)
  t.ok(chan.isChan(ch))
  t.ok(ch.toString() == 'chan.delay(100, 500)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`delay chan yields given value after the specified number of milliseconds`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(42, 'ururu')
  let recv = NOT_YET

  ch.take().then(v => recv = v).catch(t.fail)

  await t.sleep(41)
  t.ok(recv === NOT_YET)
  t.ok(ch.value === undefined)

  await t.sleep(1)
  t.ok(recv == 'ururu' && 'ururu' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`yields given value as soon as possible if the delay has already passed at time of ` +
  `the #take() call`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(42, 'ururu')
  await t.sleep(42)

  t.ok(ch.value == undefined)

  let recv = NOT_YET
  ch.take().then(v => recv = v).catch(t.fail)

  await t.nextTick()
  t.ok(recv == 'ururu' && 'ururu' == ch.value)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`value defaults to undefined`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(42)
  t.is(undefined, await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`after the value is consumed, the chan gets closed (async take)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(24, 'xyz')

  t.ok(ch.isActive == true && ch.isClosed == false)

  await t.sleep(23)
  t.ok(ch.isActive == true && ch.isClosed == false)

  await t.sleep(1)
  t.ok(ch.isActive == true && ch.isClosed == false)

  t.is('xyz', await ch.take())
  t.ok(ch.value === 'xyz')

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === 'xyz')

  t.is(chan.CLOSED, await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`after the value is consumed, the chan gets closed (sync take)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(24, 'ixy')

  t.ok(ch.isActive == true && ch.isClosed == false)

  await t.sleep(23)
  t.ok(ch.isActive == true && ch.isClosed == false)

  await t.sleep(1)
  t.ok(ch.isActive == true && ch.isClosed == false)

  t.ok(ch.takeSync() == true && ch.value === 'ixy')
  
  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === 'ixy')

  t.is(chan.CLOSED, await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`cannot be sent into`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)

  t.ok(ch.canSend == false)
  t.ok(ch.canSendSync == false)

  await t.sleep(200)

  t.ok(ch.canSend == false)
  t.ok(ch.canSendSync == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`throws on all attempts to send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)

  let assertThrowsOnSend = () => {
    t.throws(() => ch.send('x'), /not supported/)
    t.throws(() => ch.sendError(new Error('x')), /not supported/)
    t.throws(() => ch.sendSync('x'), /not supported/)
    t.throws(() => ch.sendErrorSync(new Error('x')), /not supported/)
    // internal api
    t.throws(() => ch._send('x', chan.SEND_TYPE_VALUE, t.fail, t.fail, false), /not supported/)
    t.throws(() => ch._sendSync('x', chan.SEND_TYPE_VALUE), /not supported/)
  }

  assertThrowsOnSend()
  await t.sleep(200)
  assertThrowsOnSend()
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`throws on attepmt to obtain a send-only proxy`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)
  t.throws(() => ch.sendOnly, /not supported/)
})

test(`allows to obtain take-only proxy`, async t => {
  let ch = chan.delay(100, 'x')
  let takeOnly = ch.takeOnly
  t.ok(takeOnly && chan.isChan(takeOnly))
  t.ok(takeOnly.toString() == '[<-]chan.delay(100, "x")')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`sync takes fail before delay is reached, and only one take succeeds after that`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'beavers')

  t.ok(false == ch.canTakeSync)
  t.ok(false == ch.takeSync() && ch.value === undefined)

  await t.nextTurn()

  t.ok(false == ch.canTakeSync)
  t.ok(false == ch.takeSync() && ch.value === undefined)

  await t.sleep(110)

  t.ok(true == ch.canTakeSync)
  t.ok(ch.takeSync() && ch.value == 'beavers')

  t.ok(false == ch.canTakeSync)
  t.ok(false == ch.takeSync())

  await t.sleep(100)

  t.ok(false == ch.canTakeSync)
  t.ok(false == ch.takeSync())

  t.ok(ch.value == 'beavers')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanSendSync() resolves with true as fast as possible while the chan is active, ` +
  `and with false once it becomes closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)

  t.is(true, await ch.maybeCanSendSync())
  
  await t.sleep(100)
  t.ok(ch.takeSync())

  t.is(false, await ch.maybeCanSendSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() calls block, and yield true after the delay is passed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)
  let timeline = ''

  ch.maybeCanTakeSync().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.maybeCanTakeSync().then(v => timeline += `2(${v})`).catch(t.fail)

  await t.nextTurn()
  t.ok(timeline == '')

  await t.sleep(110)
  t.ok(timeline == '1(true)2(true)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() calls yield true as soon as possible when the delay is already passed ` +
  `at time of the call`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100)
  await t.sleep(110)

  let timeline = ''

  ch.maybeCanTakeSync().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.maybeCanTakeSync().then(v => timeline += `2(${v})`).catch(t.fail)

  await t.nextTick()
  t.ok(timeline == '1(true)2(true)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() calls yield true as soon as possible when the chan is closed`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'x')

  await t.sleep(110)
  t.ok(ch.takeSync() && ch.value == 'x')

  let timeline = ''

  ch.maybeCanTakeSync().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.maybeCanTakeSync().then(v => timeline += `2(${v})`).catch(t.fail)

  await t.nextTick()
  t.ok(timeline == '1(false)2(false)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() calls yield true as soon as possible when the chan is manually closed`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'x')
  t.ok(ch.closeSync())

  let timeline = ''

  ch.maybeCanTakeSync().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.maybeCanTakeSync().then(v => timeline += `2(${v})`).catch(t.fail)

  await t.nextTick()
  t.ok(timeline == '1(false)2(false)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() calls don't interfere with normal consumers`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 42)
  let events = []

  ch.maybeCanTakeSync().then(v => events.push(`m1(${v})`)).catch(t.fail)

  ch.take().then(v => events.push(`t(${v})`)).catch(t.fail)
  await t.nextTick()
  
  ch.maybeCanTakeSync().then(v => events.push(`m2(${v})`)).catch(t.fail)

  await t.sleep(50)
  t.ok(events && events.length == 0)

  await t.sleep(50)

  t.ok(events && events.indexOf('t(42)') >= 0)
  t.ok(events && events.indexOf('m1(false)') >= 0)
  t.ok(events && events.indexOf('m2(false)') >= 0)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`supports multiple observers`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'x')
  let timeline = ''

  ch.take().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.take().then(v => timeline += `2(${v})`).catch(t.fail)
  ch.take().then(v => timeline += `3(${v})`).catch(t.fail)

  await t.sleep(50)

  t.ok(timeline == '')

  await t.sleep(50)

  t.ok(timeline == '1(x)2(<closed>)3(<closed>)')
  t.ok(ch.isActive == false && ch.isClosed == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`can be manually closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'x')
  let timeline = ''

  ch.take().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.take().then(v => timeline += `2(${v})`).catch(t.fail)

  await t.sleep(50)
  t.ok(timeline == '')

  ch.close().then(v => timeline += '.').catch(t.fail)

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())

  await t.nextTick()
  t.ok(timeline == '1(<closed>)2(<closed>).')
  
  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())

  await t.sleep(100)
  t.ok(timeline == '1(<closed>)2(<closed>).')

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`can be manually closed sync`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'x')
  let timeline = ''

  ch.take().then(v => timeline += `1(${v})`).catch(t.fail)
  ch.take().then(v => timeline += `2(${v})`).catch(t.fail)

  await t.sleep(50)
  t.ok(timeline == '')

  t.ok(ch.closeSync())
  
  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())

  await t.nextTick()
  t.ok(timeline == '1(<closed>)2(<closed>)')

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())

  await t.sleep(100)
  t.ok(timeline == '1(<closed>)2(<closed>)')

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`closing already closed chan is a nop`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 'x')

  await t.sleep(200)

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(ch.isActive == false && ch.isClosed == true)

  await ch.close()
  t.ok(ch.closeSync())

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === 'x')
  t.is(chan.CLOSED, await ch.take())

  ch = chan.delay(100, 'y')
  
  ch.closeNow()
  await ch.close()
  t.ok(ch.closeSync())

  t.ok(ch.isActive == false && ch.isClosed == true)
  t.ok(ch.takeSync() == false && ch.value === undefined)
  t.is(chan.CLOSED, await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`(internal) supports cancellation`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan.delay(100, 33)
  let th = ch.take()
  let recv = NOT_YET

  th.then(v => recv = v).catch(t.fail)

  await t.nextTick()
  t.ok('function' == typeof th._cancel)
  th._cancel()

  await t.sleep(242)
  t.ok(recv === NOT_YET)

  t.is(33, await ch.take())
})

test(`(internal) cancellation function can be called multiple times`, async t => {
  let ch = chan.delay(100)
  let th = ch.take()
  let recv = NOT_YET

  th.then(v => recv = v).catch(t.fail)

  await t.nextTick()
  t.ok('function' == typeof th._cancel)

  th._cancel()
  th._cancel()

  await t.sleep(242)
  t.ok(recv === NOT_YET)
})

test(`(internal) cancellation of one take don't affect the other ones (case 1)`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th1 = ch.take()
  let th2 = ch.take()
  let th3 = ch.take()

  th1.then(v => timeline += `1(${v})`).catch(t.fail)
  th2.then(v => timeline += `2(${v})`).catch(t.fail)
  th3.then(v => timeline += `3(${v})`).catch(t.fail)

  await t.nextTick()

  t.ok('function' == typeof th1._cancel)
  th1._cancel()

  await t.sleep(110)

  t.ok(timeline == '2(v)3(<closed>)')
})

test(`(internal) cancellation of one take don't affect the other ones (case 2)`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th1 = ch.take()
  let th2 = ch.take()
  let th3 = ch.take()

  th1.then(v => timeline += `1(${v})`).catch(t.fail)
  th2.then(v => timeline += `2(${v})`).catch(t.fail)
  th3.then(v => timeline += `3(${v})`).catch(t.fail)

  await t.nextTick()

  t.ok('function' == typeof th2._cancel)
  th2._cancel()

  await t.sleep(110)

  t.ok(timeline == '1(v)3(<closed>)')
})

test(`(internal) cancellation of one take don't affect the other ones (case 3)`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th1 = ch.take()
  let th2 = ch.take()
  let th3 = ch.take()

  th1.then(v => timeline += `1(${v})`).catch(t.fail)
  th2.then(v => timeline += `2(${v})`).catch(t.fail)
  th3.then(v => timeline += `3(${v})`).catch(t.fail)

  await t.nextTick()

  t.ok('function' == typeof th3._cancel)
  th3._cancel()

  await t.sleep(110)

  t.ok(timeline == '1(v)2(<closed>)')
})

test(`(internal) cancellation of one take don't affect the other ones (case 4)`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th1 = ch.take()
  let th2 = ch.take()
  let th3 = ch.take()

  th1.then(v => timeline += `1(${v})`).catch(t.fail)
  th2.then(v => timeline += `2(${v})`).catch(t.fail)
  th3.then(v => timeline += `3(${v})`).catch(t.fail)

  await t.nextTick()

  th1._cancel()
  th2._cancel()

  await t.sleep(110)

  t.ok(timeline == '3(v)')
})

test(`(internal) all outstanding takes can be cancelled`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th1 = ch.take()
  let th2 = ch.take()
  let th3 = ch.take()

  th1.then(v => timeline += `1(${v})`).catch(t.fail)
  th2.then(v => timeline += `2(${v})`).catch(t.fail)
  th3.then(v => timeline += `3(${v})`).catch(t.fail)

  await t.sleep(50)

  th1._cancel()
  th2._cancel()
  th3._cancel()

  await t.sleep(60)

  t.ok(timeline == '')
  t.ok(ch.takeSync() && ch.value == 'v')
})

test(`(internal) cancelled takes don't trigger when chan gets manually closed`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th = ch.take()
  th.then(v => timeline += `1(${v})`).catch(t.fail)

  await t.sleep(50)
  th._cancel()

  await ch.close()
  t.ok(timeline == '')

  await t.sleep(100)
  t.ok(timeline == '')
})

test(`(internal) cancelled takes don't trigger when chan gets manually closed sync`, async t => {
  let ch = chan.delay(100, 'v')
  let timeline = ''

  let th = ch.take()
  th.then(v => timeline += `1(${v})`).catch(t.fail)

  await t.sleep(50)
  th._cancel()

  t.ok(ch.closeSync())
  t.ok(timeline == '')

  await t.sleep(100)
  t.ok(timeline == '')
})
