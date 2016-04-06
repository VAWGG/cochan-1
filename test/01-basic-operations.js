import test from './helpers'
import chan from '../src'

test.beforeEach(t => {
  let ctx = t.context
  ctx.sent = ctx.recv = ''
  ctx.recordSent = v => { ctx.sent += (v instanceof Error ? `(${ v.message })` : v) }
  ctx.recordRecv = v => { ctx.recv += (v instanceof Error ? `(${ v.message })` : v) }
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
test(`#sendError(error) sends error to the channel, and #take() yields it`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let err = new Error('ooops')
  ch.sendError(err)
  try {
    await ch.take()
    t.fail(`no error thrown`)
  } catch (e) {
    t.ok(e === err)
  }
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#send(value) blocks until the value is consumed`, async t => {
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
test(`#sendError(error) blocks until the error is consumed`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let err = new Error('ooops')
  let sent = false

  ch.sendError(err).then(_ => sent = true).catch(t.fail)
  
  await t.nextTick()
  t.is(false, sent)

  try {
    await ch.take()
    t.fail(`no error thrown`)
  } catch (e) {
    t.ok(e === err)
  }
  
  await t.nextTick()
  t.is(true, sent)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test('send contention is handled properly', async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent} = t.ctx
  let ch = chan()
  let err = new Error(`oops`)

  ch.send('x').then(recordSent).catch(t.fail)
  ch.sendError(err).then(recordSent).catch(t.fail)
  ch.send('y').then(recordSent).catch(t.fail)

  await t.sleep(50)
  t.is(t.ctx.sent, '')

  let x = await ch.take()
  await t.nextTick()
  t.is(x, 'x')
  t.is(t.ctx.sent, 'x')

  try {
    await ch.take()
    t.fail(`error not thrown`)
  } catch (e) {
    t.ok(e === err)
  }

  await t.nextTick()
  t.is(t.ctx.sent, 'x(oops)')

  let y = await ch.take()
  await t.nextTick()
  t.is(y, 'y')
  t.is(t.ctx.sent, 'x(oops)y')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`receive contention is handled properly`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordRecv} = t.ctx
  let ch = chan()

  ch.take().then(recordRecv, t.fail)
  ch.take().then(t.fail, recordRecv)
  ch.take().then(recordRecv, t.fail)

  await t.sleep(50)
  t.is(t.ctx.recv, '')

  await ch.send('x')
  t.is(t.ctx.recv, 'x')

  await ch.sendError(new Error(`oops`))
  t.is(t.ctx.recv, 'x(oops)')

  await ch.send('y')
  t.is(t.ctx.recv, 'x(oops)y')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`multiple #send(value) calls can be fulfilled by waiting #take() calls`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent, recordRecv} = t.ctx
  let ch = chan()

  ch.take().then(t.fail, recordRecv)
  ch.take().then(recordRecv, t.fail)

  await t.nextTick()
  let err = new Error(`oops`)

  let sendE = ch.sendError(err).then(recordSent)
  let sendX = ch.send('x').then(recordSent)
  let sendY = ch.send('y').then(recordSent)

  await Promise.all([ sendE, sendX ])
  await t.sleep(50)

  t.is(t.ctx.sent, '(oops)x')
  t.is(t.ctx.recv, '(oops)x')

  await ch.take().then(recordRecv)

  t.is(t.ctx.sent, '(oops)xy')
  t.is(t.ctx.recv, '(oops)xy')

  await sendY // just to be sure it's fullfilled
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`multiple #take() calls can be fulfilled by waiting #send(value) calls`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {recordSent, recordRecv} = t.ctx
  let ch = chan()
  let err = new Error(`oops`)

  ch.send('x').then(recordSent).catch(t.fail)
  ch.sendError(err).then(recordSent).catch(t.fail)

  await t.nextTick()

  let take1 = ch.take().then(recordRecv)
  let take2 = ch.take().then(t.fail, recordRecv)
  let take3 = ch.take().then(recordRecv)

  await Promise.all([ take1, take2 ])
  await t.sleep(100)

  t.is(t.ctx.recv, 'x(oops)')
  t.is(t.ctx.sent, 'x(oops)')

  await ch.send('y').then(recordSent)

  t.is(t.ctx.recv, 'x(oops)y')
  t.is(t.ctx.sent, 'x(oops)y')

  await take3 // just to be sure it's fullfilled
})
