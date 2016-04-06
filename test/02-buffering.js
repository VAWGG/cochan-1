import test from './helpers'
import chan from '../src'

test.beforeEach(t => {
  let ctx = t.context
  ctx.sent = ctx.recv = ''
  ctx.recordSent = v => { ctx.sent += (v instanceof Error ? `(${ v.message })` : v) }
  ctx.recordRecv = v => { ctx.recv += (v instanceof Error ? `(${ v.message })` : v) }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`buffered chan doesn't block sends it can buffer`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(3)
  await ch.send(1)
  await ch.send(2)
  await ch.sendError(new Error())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`buffered chan starts blocking sends when its buffer gets full`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)
  await ch.send(1)
  await ch.send(2)
  ch.send(3).then(t.fail.with(`send succeeded`)).catch(t.fail)
  await t.sleep(50)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#take() can consume buffered values without blocking`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)
  let err = new Error(`oops`)
  ch.send('x')
  ch.sendError(err)
  await t.nextTick()
  let x = await ch.take()
  t.ok(x == 'x')
  try {
    await ch.take()
    t.fail(`no error thrown`)
  } catch (e) {
    t.ok(e === err)
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#take() starts blocking when no values are left in the buffer`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(2)
  ch.send(1)
  ch.send(2)
  await ch.take()
  await ch.take()
  ch.take().then(t.fail.with(`taken value: $$`)).catch(t.fail)
  await t.sleep(50)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`blocked #send(value) calls get unblocked when their values get buffered`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  await ch.send('x') // gets buffered right away, should not block
  let ySent = ch.send('y') // blocked
  await ch.take() // this should unblock the second send
  await ySent // check it's really unblocked
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`blocked #sendError(error) calls get unblocked when their values get buffered`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  let errX = new Error(`x`)
  let errY = new Error(`y`)
  await ch.sendError(errX) // gets buffered right away, should not block
  let ySent = ch.sendError(errY) // blocked
  await ch.take().then(t.fail, t.nop) // this should unblock the second send
  await ySent // check it's really unblocked
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) calls fulfill waiting consumers even if they can be buffered`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let {recordRecv} = t.ctx
  let ch = chan(2)

  ch.take().then(recordRecv, t.fail)
  ch.take().then(t.fail, recordRecv)

  await t.nextTick()
  let err = new Error(`oops`)

  // sent to consumers
  await ch.send('a')
  await ch.sendError(err)

  t.is(t.ctx.recv, 'a(oops)')

  // buffered
  await ch.sendError(err)
  await ch.send('b')

  t.is(t.ctx.recv, 'a(oops)')

  t.is(await ch.take().then(t.fail, e => e), err)
  t.is(await ch.take(), 'b')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) calls fulfill waiting consumers even if they can be buffered (concurrent)`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let {recordRecv} = t.ctx
  let ch = chan(2)
  let err = new Error(`oops`)

  ch.take().then(recordRecv, t.fail)
  ch.take().then(t.fail, recordRecv)

  await t.nextTick()

  await Promise.all([
    // sent to consumers
    ch.send('a'),
    ch.sendError(err),
    // buffered
    ch.sendError(err),
    ch.send('b')
  ])

  t.is(t.ctx.recv, 'a(oops)')

  let eRecv = ch.take().then(t.fail, e => e)
  let bRecv = ch.take()

  t.same(await Promise.all([ eRecv, bRecv ]), [ err, 'b' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`send contention is handled properly`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent} = t.ctx
  let ch = chan(2)

  ch.send('a').then(recordSent).catch(t.fail)
  ch.send('b').then(recordSent).catch(t.fail)

  ch.send('c').then(recordSent).catch(t.fail)
  ch.send('d').then(recordSent).catch(t.fail)

  t.is(t.ctx.sent, '')

  await t.nextTick()
  t.is(t.ctx.sent, 'ab')

  let w = await ch.take()
  await t.nextTick()

  t.is(w, 'a')
  t.is(t.ctx.sent, 'abc')

  let x = await ch.take()
  await t.nextTick()

  t.is(x, 'b')
  t.is(t.ctx.sent, 'abcd')

  let c = await ch.take()
  let d = await ch.take()

  t.is(c, 'c')
  t.is(d, 'd')
  t.is(t.ctx.sent, 'abcd')
})
