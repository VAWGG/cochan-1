import test from './helpers'
import chan from '../src'

test.timeout(1000)

function assertActive(ch, t) {
  t.ok(ch.isClosed == false)
  t.ok(ch.isActive == true)
}

function assertClosing(ch, t) {
  t.ok(ch.isClosed == false)
  t.ok(ch.isActive == false)
}

function assertClosed(ch, t) {
  t.ok(ch.isClosed == true)
  t.ok(ch.isActive == false)
}

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() closes the chan immediately in the absence of buffered values or waiting sends`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch1 = chan(0)
  let ch2 = chan(1)

  assertActive(ch1, t)
  assertActive(ch2, t)

  await ch1.close()
  await ch2.close()

  assertClosed(ch1, t)
  assertClosed(ch2, t)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() waits until all waiting sends' values get consumed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let timeline = ''

  ch.send('a').then(v => timeline += v).catch(t.fail)
  ch.send('b').then(v => timeline += v).catch(t.fail)

  // FIXME: this is needed because #send() waits until next tick before actually
  // sending anything, which is needed for chan.select() to be able to cancel it
  // when some op can be performed synchronously. But #close() doesn't perform
  // equivalent wait, because it doesn't need to. So, if we didn't wait until the
  // next tick here, #close() would synchronously close the channel before the two
  // sends above execute, and when they execute, they will attempt to send into
  // a closed channel and fail.
  //
  // This situation is not very counter-intuitive and it would be great to fix it.
  //
  // One option is to add wait for the next tick to #close(), but that wouldn't
  // really fix anything, as there is also #closeSync(), which we cannot delay.
  //
  // The other option is to remove wait from #send() and #take(), but then we
  // lose the ability to pass them into select(), and need to introduce another
  // way to use send, e.g. chan.select(chan.send(a, 1), chan.take(b)). Which
  // is really not an option at all.
  //
  // The third option is to make #send() and #take() execute only after #then()
  // is called on their thenables. This is even worse than current situation,
  // because ch.send('x') is not working anymore, and you need to call
  // ch.send('x').then() to kickstart it.
  //
  // So we need to find some different solution to this.
  //
  await t.nextTick()
  assertActive(ch, t)

  let closed = ch.close().then(_ => timeline += '.').catch(t.fail)
  assertClosing(ch, t)

  await t.nextTurn()
  t.is('', timeline)
  assertClosing(ch, t)

  t.is('a', await ch.take())

  t.is('a', timeline)
  assertClosing(ch, t)

  t.is('b', await ch.take())
  assertClosed(ch, t)

  await t.nextTick()
  t.is('ab.', timeline)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() waits until all waiting sends' values get consumed (sync take)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let timeline = ''

  ch.send('a').then(v => timeline += v).catch(t.fail)
  ch.send('b').then(v => timeline += v).catch(t.fail)
  await t.nextTick()

  let closed = ch.close().then(_ => timeline += '.').catch(t.fail)
  assertClosing(ch, t)

  t.is(true, ch.takeSync())
  t.is('a', ch.value)
  assertClosing(ch, t)

  t.is(true, ch.takeSync())
  t.is('b', ch.value)
  assertClosed(ch, t)

  t.is('', timeline)
  await t.nextTick()
  t.is('ab.', timeline)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() waits until all buffered values get consumed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)
  let closeUnblocked = false

  await ch.send('x')
  await ch.send('y')

  t.ok(closeUnblocked == false)
  assertActive(ch, t)

  let closed = ch.close().then(_ => closeUnblocked = true).catch(t.fail)

  assertClosing(ch, t)
  t.ok(closeUnblocked == false)

  await t.nextTurn()

  assertClosing(ch, t)
  t.ok(closeUnblocked == false)

  t.is('x', await ch.take())
  t.ok(closeUnblocked == false)
  assertClosing(ch, t)

  t.is('y', await ch.take())
  assertClosed(ch, t)

  await t.nextTick()
  t.ok(closeUnblocked == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() waits until all buffered values get consumed (sync take)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)
  let closeUnblocked = false

  await ch.send('x')
  await ch.send('y')

  let closed = ch.close().then(_ => closeUnblocked = true).catch(t.fail)
  assertClosing(ch, t)

  t.ok(true == ch.takeSync())
  t.ok('x' == ch.value)
  t.ok(false == closeUnblocked)
  assertClosing(ch, t)

  t.ok(true == ch.takeSync())
  t.ok('y' == ch.value)
  assertClosed(ch, t)

  await t.nextTick()
  t.ok(true == closeUnblocked)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() waits until all buffered and waiting sends' values get consumed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)

  let timeline = ''
  let log = v => timeline += v

  ch.send('a').then(log).catch(t.fail)
  ch.send('b').then(log).catch(t.fail)

  ch.send('x').then(log).catch(t.fail)
  ch.send('y').then(log).catch(t.fail)

  await t.nextTick()

  t.is('ab', timeline)
  assertActive(ch, t)

  let closed = ch.close().then(_ => log('.')).catch(t.fail)

  t.is('ab', timeline)
  assertClosing(ch, t)

  await t.nextTick()

  t.is('ab', timeline)
  assertClosing(ch, t)

  t.is('a', await ch.take())
  t.is('b', await ch.take())

  t.is('abxy', timeline)
  assertClosing(ch, t)

  t.is('x', await ch.take())
  t.is('abxy', timeline)
  assertClosing(ch, t)

  t.is('y', await ch.take())
  await t.nextTick()

  t.is('abxy.', timeline)
  assertClosed(ch, t)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`receiving from a closed channel yields chan.CLOSED`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let chX = chan(0)
  let chY = chan(0)
  let chZ = chan(1)

  chY.send('y')
  await chY.take()

  chZ.send('z')
  await chZ.take()

  await chX.close()
  await chY.close()
  await chZ.close()

  t.is(chan.CLOSED, await chX.take())
  t.is(chan.CLOSED, await chY.take())
  t.is(chan.CLOSED, await chZ.take())

  t.is(chan.CLOSED, await chX.take())
  t.is(chan.CLOSED, await chY.take())
  t.is(chan.CLOSED, await chZ.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() resolves all pending receives with chan.CLOSED`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let events = []

  ch.take().then(v => events.push('take1', v)).catch(t.fail)
  ch.take().then(v => events.push('take2', v)).catch(t.fail)

  await t.nextTick()

  await ch.close()
  t.same(events, [ 'take1', ch.CLOSED, 'take2', ch.CLOSED ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`sending into a closed channel results in an error`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  await ch.close()
  await t.throws(ch.send('x'), /closed channel/)
  await t.throws(ch.send('y'), /closed channel/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`sending into a closing channel results in an error`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.send('x')
  ch.close()
  await t.throws(ch.send('a'), /closed channel/)
  await t.throws(ch.send('b'), /closed channel/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#closeNow() closes the chan immediately`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch1 = chan(0)
  let ch2 = chan(1)
  let ch3 = chan(0)

  ch1.send('x')
  ch2.send('y')
  await t.nextTick()

  ch1.closeNow(); ch2.closeNow(); ch3.closeNow()

  assertClosed(ch1, t)
  assertClosed(ch2, t)
  assertClosed(ch3, t)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#closeNow() resolves all pending receives with chan.CLOSED`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let events = []

  ch.take().then(v => events.push('take1', v)).catch(t.fail)
  ch.take().then(v => events.push('take2', v)).catch(t.fail)

  await t.nextTick()

  ch.closeNow()
  await t.nextTick()

  t.same(events, [ 'take1', ch.CLOSED, 'take2', ch.CLOSED ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#closeNow() can be used on a closing channel`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch1 = chan(0)
  let ch2 = chan(1)

  ch1.send('x')
  await ch2.send('y')

  ch1.close()
  ch2.close()

  assertClosing(ch1, t)
  assertClosing(ch2, t)

  ch1.closeNow()
  ch2.closeNow()

  assertClosed(ch1, t)
  assertClosed(ch2, t)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() and #closeNow() can be used on a closed channel`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  ch.closeNow()
  assertClosed(ch, t)

  await ch.close()
  assertClosed(ch, t)

  ch.closeNow()
  assertClosed(ch, t)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() contention is handled properly on a non-buffered chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sent = false
  let recv = []

  ch.send('x').then(_ => sent = true).catch(t.fail)
  await t.nextTick()

  let closed1 = ch.close()
  let closed2 = ch.close()

  assertClosing(ch, t)
  t.ok(sent == false)

  let take1 = ch.take().then(v => recv.push('take1', v))
  assertClosing(ch, t)

  let take2 = ch.take().then(v => recv.push('take2', v))
  assertClosing(ch, t)

  await take1; await take2
  await t.nextTick()

  assertClosed(ch, t)

  t.ok(sent == true)
  t.same(recv, [ 'take1', 'x', 'take2', chan.CLOSED ])

  await closed1; await closed2
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#close() contention is handled properly on a buffered chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  let recv = []

  await ch.send('x')

  let closed1 = ch.close()
  let closed2 = ch.close()

  assertClosing(ch, t)

  let take1 = ch.take().then(v => recv.push('take1', v))
  assertClosing(ch, t)

  let take2 = ch.take().then(v => recv.push('take2', v))
  assertClosing(ch, t)

  await take1; await take2
  await t.nextTick()

  assertClosed(ch, t)
  t.same(recv, [ 'take1', 'x', 'take2', chan.CLOSED ])

  await closed1; await closed2
})
