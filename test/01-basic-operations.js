import test from './helpers'
import chan from '../src'

test.beforeEach(t => {
  let ctx = t.context
  ctx.sent = ctx.recv = ''
  ctx.recordSent = v => { ctx.sent += v }
  ctx.recordRecv = v => { ctx.recv += v }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) can be called on a newly created channel`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.send(1)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#take() can be called on a newly created channel`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.take()
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) sends value to the channel, and #take() receives it`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  ch.send(7)
  let value = await ch.take()
  t.is(value, 7)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) blocks until the value is sent`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let sent = false

  ch.send('x').then(_ => sent = true).catch(t.fail)
  
  await t.nextTick()
  t.is(false, sent)

  await ch.take()
  await t.nextTick()
  
  t.is(true, sent)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test('send contention is handled properly', async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent} = t.ctx
  let ch = chan()

  ch.send('x').then(recordSent).catch(t.fail)
  ch.send('y').then(recordSent).catch(t.fail)
  ch.send('z').then(recordSent).catch(t.fail)

  await t.sleep(50)
  t.is(t.ctx.sent, '')

  let x = await ch.take(); await t.nextTick()
  t.is(x, 'x')
  t.is(t.ctx.sent, 'x')

  let y = await ch.take(); await t.nextTick()
  t.is(y, 'y')
  t.is(t.ctx.sent, 'xy')

  let z = await ch.take(); await t.nextTick()
  t.is(z, 'z')
  t.is(t.ctx.sent, 'xyz')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`receive contention is handled properly`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordRecv} = t.ctx
  let ch = chan()

  ch.take().then(recordRecv).catch(t.fail)
  ch.take().then(recordRecv).catch(t.fail)
  ch.take().then(recordRecv).catch(t.fail)

  await t.sleep(50)
  t.is(t.ctx.recv, '')

  await ch.send('x')
  t.is(t.ctx.recv, 'x')

  await ch.send('y')
  t.is(t.ctx.recv, 'xy')

  await ch.send('z')
  t.is(t.ctx.recv, 'xyz')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`multiple #send(value) calls can be fulfilled by waiting #take() calls`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent, recordRecv} = t.ctx
  let ch = chan()
  
  ch.take().then(recordRecv).catch(t.fail)
  ch.take().then(recordRecv).catch(t.fail)

  await t.nextTick()

  let sendX = ch.send('x').then(recordSent)
  let sendY = ch.send('y').then(recordSent)
  let sendZ = ch.send('z').then(recordSent)

  await Promise.all([ sendX, sendY ])
  await t.sleep(50)

  t.is(t.ctx.sent, 'xy')
  t.is(t.ctx.recv, 'xy')

  await ch.take().then(recordRecv)

  t.is(t.ctx.sent, 'xyz')
  t.is(t.ctx.recv, 'xyz')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`multiple #take() calls can be fulfilled by waiting #send(value) calls`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent, recordRecv} = t.ctx
  let ch = chan()

  ch.send('x').then(recordSent).catch(t.fail)
  ch.send('y').then(recordSent).catch(t.fail)

  await t.nextTick()

  let take1 = ch.take().then(recordRecv)
  let take2 = ch.take().then(recordRecv)
  let take3 = ch.take().then(recordRecv)

  await Promise.all([ take1, take2 ])
  await t.sleep(100)

  t.is(t.ctx.recv, 'xy')
  t.is(t.ctx.sent, 'xy')

  await ch.send('z').then(recordSent)

  t.is(t.ctx.recv, 'xyz')
  t.is(t.ctx.sent, 'xyz')
})
