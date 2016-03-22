import test from './helpers'
import chan from '../src'

const NOT_YET = { notYet: true }

test.timeout(1000)

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() blocks until there is a pending send in a non-buffered chan, and ` +
  `returns true when unblocked`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)
  await t.nextTurn()

  t.ok(unblockedWith == NOT_YET)

  let sent = false

  ch.send('x').then(_ => sent = true).catch(t.fail)
  await t.nextTick()

  t.ok(unblockedWith == true)
  t.ok(sent == false)

  t.is('x', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`blocks until there is a buffered value in a buffered chan, and returns true ` +
  `when unblocked`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(3)
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)
  await t.nextTurn()

  t.ok(unblockedWith == NOT_YET)

  await ch.send('x')
  await t.nextTick()

  t.ok(unblockedWith == true)

  t.is('x', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`blocks until there is a buffered value in a buffered chan, and returns true when ` +
  `unblocked (sync send)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)
  await t.nextTurn()

  t.ok(unblockedWith == NOT_YET)

  ch.sendSync('x')
  await t.nextTick()

  t.ok(unblockedWith == true)

  t.is('x', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked on the next turn after a failed sync send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)

  // initially blocked
  await t.nextTick()
  t.ok(unblockedWith == NOT_YET)

  // failed send
  t.ok(ch.sendSync('x') == false)

  // still blocked on the next tick
  let p1 = t.nextTick().then(_ => t.ok(unblockedWith == NOT_YET))

  // unblocked on the next turn
  let p2 = t.nextTurn().then(_ => t.ok(unblockedWith == true))

  await Promise.all([ p1, p2 ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked by a maybeCanSendSync`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let maybeCanTake = NOT_YET
  let maybeCanSend = NOT_YET

  ch.maybeCanTakeSync().then(v => maybeCanTake = v).catch(t.fail)
  ch.maybeCanSendSync().then(v => maybeCanSend = v).catch(t.fail)

  await t.nextTick()
  t.ok(maybeCanTake == true)

  await t.nextTurn()
  t.ok(maybeCanSend == NOT_YET)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`doesn't consume`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)

  ch.maybeCanTakeSync()

  await ch.send('x')
  ch.sendSync('y')
  ch.send('z')

  await ch.maybeCanTakeSync()

  t.is('x', await ch.take())
  t.is('y', await ch.take())
  t.is('z', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns true if there is a waiting send in the chan at the time of the call`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sent = false

  ch.send('x').then(_ => sent = true).catch(t.fail)
  await t.nextTick()

  t.is(true, await ch.maybeCanTakeSync())
  t.is('x', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns true if there is a buffered value in the chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  ch.sendSync('x')
  t.is(true, await ch.maybeCanTakeSync())
  t.is('x', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`remains blocked after receive`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblocked = false

  ch.maybeCanTakeSync().then(_ => unblocked = true).catch(t.fail)

  ch.take()
  ch.takeSync()

  await t.nextTurn()
  t.ok(unblocked == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`remains blocked when sends get immediately consumed (non-buffered chan)`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan()
  let unblocked = false

  ch.maybeCanTakeSync().then(_ => unblocked = true).catch(t.fail)

  let pRecv = ch.take()
  await t.nextTick()

  await ch.send('x')
  await t.nextTurn()

  t.ok(unblocked == false)
  t.is('x', await pRecv)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`remains blocked when sends get immediately consumed (buffered chan)`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan(3)
  let unblocked = false

  ch.maybeCanTakeSync().then(_ => unblocked = true).catch(t.fail)

  let pRecv = ch.take()
  await t.nextTick()

  await ch.send('x')
  await t.nextTurn()

  t.ok(unblocked == false)
  
  t.is('x', await pRecv)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan gets closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)

  await ch.close()
  t.ok(true == ch.isClosed)

  await t.nextTurn()
  t.ok(unblockedWith == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan gets synchronously closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)

  t.ok(true == ch.closeSync())
  t.ok(true == ch.isClosed)

  await t.nextTurn()
  t.ok(unblockedWith == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan gets immediately closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)

  ch.closeNow()
  t.ok(true == ch.isClosed)

  await t.nextTurn()
  t.ok(unblockedWith == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`doesn't interfere with chan closing`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sent = false
  let closed = false
  
  ch.send('x').then(_ => sent = true).catch(t.fail)
  await t.nextTick()

  ch.maybeCanTakeSync()
  ch.close().then(_ => closed = true).catch(t.fail)

  await t.nextTick()
  t.ok(sent == false)
  t.ok(closed == false)

  t.ok('x' == await ch.take())
  await t.nextTick()

  t.ok(sent == true)
  t.ok(closed == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan is already closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.closeNow()
  t.is(false, await ch.maybeCanTakeSync())
  t.is(false, await ch.maybeCanTakeSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`multiple calls get unblocked by the same send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(3)
  let events = ''

  ch.maybeCanTakeSync().then(v => events += `1(${v})`).catch(t.fail)
  ch.maybeCanTakeSync().then(v => events += `2(${v})`).catch(t.fail)
  ch.maybeCanTakeSync().then(v => events += `3(${v})`).catch(t.fail)

  await ch.send('x')
  await t.nextTick()

  t.ok(events == '1(true)2(true)3(true)')
})
