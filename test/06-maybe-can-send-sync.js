import test from './helpers'
import chan from '../src'

const NOT_YET = { notYet: true }

test.timeout(1000)

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanSendSync() blocks until there is a pending take on a non-buffered chan, and ` +
  `returns true when unblocked`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)
  await t.sleep(50)

  t.ok(unblockedWith == NOT_YET)

  let recv = NOT_YET

  ch.take().then(v => recv = v).catch(t.fail)
  await t.nextTick()

  t.ok(unblockedWith == true)
  t.ok(recv == NOT_YET)

  await ch.send('q')
  t.is('q', recv)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked on the next turn after a failed sync take`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)

  // failed take
  t.ok(false == ch.takeSync())

  await Promise.all([
    // still blocked on the next tick
    t.nextTick().then(_ => t.ok(unblockedWith == NOT_YET)),
    // unblocked on the next turn
    t.nextTurn().then(_ => t.ok(unblockedWith == true))
  ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked by a maybeCanTakeSync`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let maybeCanSend = NOT_YET
  let maybeCanTake = NOT_YET

  ch.maybeCanSendSync().then(v => maybeCanSend = v).catch(t.fail)
  ch.maybeCanTakeSync().then(v => maybeCanTake = v).catch(t.fail)

  await t.nextTick()
  t.ok(maybeCanSend == true)

  await t.nextTurn()
  t.ok(maybeCanTake == NOT_YET)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`remains blocked after a send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET

  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)

  ch.send('x')
  ch.sendSync('y')
  await t.nextTurn()

  t.ok(unblockedWith == NOT_YET)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`remains blocked after a take satisfied by a pending send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET
  let pSent = ch.send('x')

  await t.nextTick()
  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)

  t.ok('x' == await ch.take())

  await t.nextTurn()
  t.ok(unblockedWith == NOT_YET)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`remains blocked after a sync take satisfied by a pending send`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET
  let pSent = ch.send('x')

  await t.nextTick()
  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)

  t.ok(true == ch.takeSync())
  t.ok('x' == ch.value)

  await t.nextTick()
  t.ok(unblockedWith == NOT_YET)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked with false when chan gets closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET
  
  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)
  await ch.close()

  t.ok(unblockedWith == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`gets unblocked with false when chan starts closing`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let unblockedWith = NOT_YET
  let sent = false
  let closed = false
  
  ch.send('x').then(_ => sent = true).catch(t.fail)
  await t.nextTick()

  ch.maybeCanSendSync().then(v => unblockedWith = v).catch(t.fail)
  ch.close().then(_ => closed = true).catch(t.fail)

  await t.nextTick()

  t.ok(sent == false)
  t.ok(closed == false)
  t.ok(unblockedWith == false)

  t.ok('x' == await ch.take())
  await t.nextTick()
  
  t.ok(sent == true)
  t.ok(closed == true)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns true when buffered chan has spare buffer capacity`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  t.ok(true == await ch.maybeCanSendSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns true when there is a waiting take on a chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let recv = NOT_YET

  ch.take().then(v => recv = v).catch(t.fail)
  await t.nextTick()

  t.ok(true == await ch.maybeCanSendSync())

  await ch.send('y')
  t.ok(recv == 'y')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan is closed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.closeNow()
  t.ok(false == await ch.maybeCanSendSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`returns false when chan is closing`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sent = false
  let closed = false

  ch.send('q').then(_ => sent = true).catch(t.fail)
  await t.nextTick()
  ch.close().then(_ => closed = true).catch(t.fail)
  
  t.ok(false == await ch.maybeCanSendSync())
  t.ok(false == sent)
  t.ok(false == closed)

  t.is('q', await ch.take())

  await t.nextTick()
  t.ok(true == sent)
  t.ok(true == closed)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`multiple calls get unblocked by the same take`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let events = ''

  ch.maybeCanSendSync().then(v => events += `1(${v})`).catch(t.fail)
  ch.maybeCanSendSync().then(v => events += `2(${v})`).catch(t.fail)
  ch.maybeCanSendSync().then(v => events += `3(${v})`).catch(t.fail)

  ch.take()
  await t.nextTick()

  t.ok(events == '1(true)2(true)3(true)')
})
