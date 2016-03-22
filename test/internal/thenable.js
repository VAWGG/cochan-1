import test from '../helpers'
import chan from '../../src'

test.timeout(1000)

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the objects returned from #take() and #send() are Promise-like`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan()
  
  let o1 = ch.take()
  let o2 = ch.send(1)

  t.ok('function' == typeof o1.then && o1.then.length == 2)
  t.ok('function' == typeof o2.then && o2.then.length == 2)

  t.ok('function' == typeof o1.catch && o1.catch.length == 1)
  t.ok('function' == typeof o2.catch && o2.catch.length == 1)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`thenable returned from #send(value) doesn't release Zalgo`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sent = false

  ch.send(1).then(_ => { sent = true }, t.fail)
  await t.nextTick()

  ch.takeSync()
  t.is(false, sent)

  await t.nextTick()
  t.is(true, sent)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`thenable returned from #take() doesn't release Zalgo`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let received = false

  ch.take().then(v => received = v).catch(t.fail)
  await t.nextTick()

  ch.sendSync(1)
  t.is(false, received)
  
  await t.nextTick()
  t.is(1, received)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#then() function can be used to add multiple observers (fulfilled case)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let events = ''
  let sent = ch.send('x')

  sent.then(v => events += `1(${v})`, t.fail)
  sent.then(v => events += `2(${v})`, t.fail)

  await t.nextTick()
  t.is('', events)

  ch.take()
  await sent

  t.is('1(x)2(x)', events)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#then() function can be used to add multiple observers (rejected case)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.closeNow()

  let events = []
  let sent = ch.send('x')

  sent.then(t.fail, e => events.push(1, e))
  sent.then(t.fail, e => events.push(2, e))

  t.ok(events.length == 0)
  await t.nextTick()

  let err = events[1]

  t.same(events, [ 1, err, 2, err ])
  t.ok(events[1] === events[3])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`both arguments to #then() are optional`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.take().then()
  ch.take().then(undefined, t.nop)
  await ch.send(1)
  await ch.send(2)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#then() and #catch() functions return a Promise`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let p = ch.send('x').then()
  t.ok(p instanceof global.Promise)
  let q = ch.send('x').catch(t.nop)
  t.ok(q instanceof global.Promise)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the returned Promise follows thenable`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  let th = ch.take()
  let p = th.then()
  ch.send(123)
  t.is(123, await p)
  p = th.then()
  t.is(123, await p)

  await ch.close()
  th = ch.send(456)
  p = th.then()
  await t.throws(p, /closed channel/)
  p = th.then()
  await t.throws(p, /closed channel/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#then() can be used to alter the value to which the Promise settles`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let p = ch.take().then(v => 2 * v)
  ch.send(111)
  t.is(222, await p)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#then() can be used to suppress an error`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.closeNow()
  let th = ch.send(0)
  let p = th.then(undefined, e => e.message)
  t.regex(await p, /closed channel/)
  p = th.then(undefined, e => e.message)
  t.regex(await p, /closed channel/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when fullfillment handler throws, the Promise gets rejected with the thrown error`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan(1)
  let err = new Error('ururu')
  let p = ch.send(0).then(_ => { throw err })
  await t.throws(p, e => e === err)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when rejection handler throws, the Promise gets rejected with the thrown error`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan()
  ch.closeNow()
  let err = new Error('ururu')
  let p = ch.send(0).then(undefined, _ => { throw err })
  await t.throws(p, e => e === err)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the passed handlers execute before the returned Promise gets settled (resolved case)`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let ch = chan()
  let events = ''

  let promise = ch.send('x').then(_ => events += '1')
  promise = promise.then(_ => events += '2')
  
  ch.take()
  await promise

  t.is(events, '12')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the passed handlers execute before the returned Promise gets settled (rejected case)`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let events = ''

  let ch = chan()
  ch.close()

  let promise = ch.send('x').then(undefined, _ => events += '1')
  promise = promise.then(_ => events += '2')
  
  ch.take()
  await promise

  t.is(events, '12')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`initially, thenable is not sealed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  let t1 = ch.send(1)
  let t2 = ch.take()
  
  t.ok(!t1._isSealed)
  t.ok(!t2._isSealed)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`thenable can be sealed, in which case calling #then() or #catch() will throw`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  let thenable1 = ch.send(1)
  let thenable2 = ch.take()

  thenable1._seal()
  thenable2._seal()

  t.ok(thenable1._isSealed)
  t.ok(thenable2._isSealed)

  t.throws(() => { thenable1.then() })
  t.throws(() => { thenable1.then(t.nop, t.nop) })
  t.throws(() => { thenable1.catch() })
  t.throws(() => { thenable1.catch(t.nop) })

  t.throws(() => { thenable2.then() })
  t.throws(() => { thenable2.then(t.nop, t.nop) })
  t.throws(() => { thenable2.catch() })
  t.throws(() => { thenable2.catch(t.nop) })
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`sealed thenable can be unsealed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let th = ch.take()

  th._seal()
  t.ok(th._isSealed)

  th._unseal()
  t.ok(!th._isSealed)

  ch.send(1)
  t.is(await th.then(), 1)
})
