import test from './helpers'
import chan from '../src'

test.beforeEach(t => {
  let ctx = t.context
  ctx.sent = ctx.recv = ''
  ctx.recordSent = v => { ctx.sent += v }
  ctx.recordRecv = v => { ctx.recv += v }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`buffered chan doesn't block sends it can buffer`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(3)
  await ch.send(1)
  await ch.send(2)
  await ch.send(3)
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
  ch.send('x')
  ch.send('y')
  await t.nextTick()
  let x = await ch.take()
  t.is('x', x)
  let y = await ch.take()
  t.is('y', y)
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
test(`#send(value) calls fulfill waiting consumers even if they can be buffered`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let {recordRecv} = t.ctx
  let ch = chan(2)

  ch.take().then(recordRecv).catch(t.fail)
  ch.take().then(recordRecv).catch(t.fail)

  await t.nextTick()

  // sent to consumers
  await ch.send('a')
  await ch.send('b')

  t.is(t.ctx.recv, 'ab')

  // buffered
  await ch.send('c')
  await ch.send('d')

  t.is(t.ctx.recv, 'ab')

  t.is(await ch.take(), 'c')
  t.is(await ch.take(), 'd')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) calls fulfill waiting consumers even if they can be buffered (concurrent)`,
////////////////////////////////////////////////////////////////////////////////////////////////////
async t => {
  let {recordRecv} = t.ctx
  let ch = chan(2)

  ch.take().then(recordRecv).catch(t.fail)
  ch.take().then(recordRecv).catch(t.fail)

  await t.nextTick()

  await Promise.all([
    // sent to consumers
    ch.send('a'),
    ch.send('b'),
    // buffered
    ch.send('c'),
    ch.send('d')
  ])

  t.is(t.ctx.recv, 'ab')

  let cRecv = ch.take()
  let dRecv = ch.take()

  t.same(await Promise.all([ cRecv, dRecv ]), [ 'c', 'd' ])
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
