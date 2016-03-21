import test from './helpers'
import chan from '../src'

test.timeout(1000)

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() blocks until there is a pending send in a non-buffered chan, and ` +
  `returns true when unblocked`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)
  await t.sleep(50)

  t.ok(unblockedWith === undefined)

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
  let unblockedWith

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)
  await t.sleep(50)

  t.ok(unblockedWith === undefined)

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
  let unblockedWith

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)
  await t.sleep(50)

  t.ok(unblockedWith === undefined)

  ch.sendSync('x')
  await t.nextTick()

  t.ok(unblockedWith == true)

  t.is('x', await ch.take())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked on the next turn after a failed sync send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)

  // initially blocked
  await t.nextTick()
  t.ok(unblockedWith === undefined)

  // failed send
  t.ok(ch.sendSync('x') == false)

  // still blocked on the next tick
  let p1 = t.nextTick().then(_ => t.ok(unblockedWith == undefined))

  // unblocked on the next turn
  let p2 = t.nextTurn().then(_ => t.ok(unblockedWith == true))

  await Promise.all([ p1, p2 ])
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
test(`returns true when there is an outstanding value in the chan at the time ` +
  `of the call`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch

  ch = chan()
  ch.send('x'); await t.nextTick()
  t.is(true, await ch.maybeCanTakeSync())

  ch = chan(1)
  ch.sendSync('x')
  t.is(true, await ch.maybeCanTakeSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`doesn't get unblocked by receives`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblocked = false

  ch.maybeCanTakeSync().then(_ => unblocked = true).catch(t.fail)

  ch.take()
  ch.takeSync()

  await t.sleep(50)
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
  t.ok(unblocked == false)
  
  t.is('x', await pRecv)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan gets closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith

  ch.maybeCanTakeSync().then(v => unblockedWith = v).catch(t.fail)

  await ch.close()

  t.ok(unblockedWith === false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan is closed at the time of the call`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
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
