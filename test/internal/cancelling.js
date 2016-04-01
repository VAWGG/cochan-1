import test from '../helpers'
import chan from '../../src'

test(`a waiting publisher can be immediately cancelled`, async t => {
  let ch = chan()
  let cancel = ch._send('x', false, t.fail, t.fail, true)
  cancel()
  ch.take().then(t.fail.with(`take succeeded: $$`)).catch(t.fail)
  await t.sleep(50)
})

test(`a waiting publisher can be cancelled later`, async t => {
  let ch = chan()
  let cancel = ch._send('x', false, t.fail, t.fail, true)
  await t.sleep(50)
  cancel()
  ch.take().then(t.fail.with(`take succeeded: $$`)).catch(t.fail)
  await t.sleep(50)
})

test(`cancelling a publisher doesn't cancel another ones`, async t => {
  let ch = chan()
  let cancelX = ch._send('x', false, t.nop, t.nop, true)
  let cancelY = ch._send('y', false, t.nop, t.nop, true)
  cancelX()
  t.ok(ch.takeSync() && ch.value == 'y')
  await ch.close()
})

test(`cancelled publishers don't block closing`, async t => {
  let ch = chan()
  let cancelX = ch._send('x', false, t.nop, t.nop, true)
  let cancelY = ch._send('y', false, t.nop, t.nop, true)
  cancelX()
  cancelY()
  await ch.close()
})

test(`closing gets unblocked when current publishers cancel`, async t => {
  let ch = chan()
  let cancelPub = ch._send('x', false, t.nop, t.nop, true)
  let closed = ch.close()
  cancelPub()
  await closed
})

test(`buffered _send gets processed immediately and cannot be cancelled`, async t => {
  let ch = chan(1)
  let sent = false
  let cancel = ch._send('x', false, () => { sent = true }, t.fail, true)
  t.is(true, sent)
  cancel()
  t.is('x', await ch.take())
})

test(`buffered #send() can be immediately cancelled through the returned thenable`, async t => {
  let ch = chan(1)
  let thenable = ch.send('x')
  thenable.then(t.fail.with(`send succeeded`)).catch(t.fail)
  thenable._op = 0
  ch.take().then(t.fail.with(`take succeeded: $$`)).catch(t.fail)
  await t.sleep(50)
})

test(`blocked _take can be immediately cancelled`, async t => {
  let ch = chan()
  let cancel = ch._take(t.fail.with(`take succeeded: $$`), t.fail, true)
  cancel()
  ch.send('x').then(t.fail.with(`send succeeded`)).catch(t.fail)
  await t.sleep(50)
})

test(`in presence of a waiting send, _take gets processed immediately and cannot be cancelled`,
async t => {
  let ch = chan()
  let sent = false
  let recv = false
  ch._send('x', false, () => { sent = true }, t.fail, false)
  let cancel = ch._take(() => { recv = true }, t.fail, true)
  t.is(true, sent)
  t.is(true, recv)
  cancel()
})

test(`in presence of a buffered value, _take gets processed immediately and cannot be cancelled`,
async t => {
  let ch = chan(1)
  let recv = false
  await ch.send('x')
  let cancel = ch._take(() => { recv = true }, t.fail, true)
  t.is(true, recv)
  cancel()
})

test(`#take() can be immediately cancelled through the returned thenable`, async t => {
  let ch = chan(1)
  await ch.send('x')
  let thenable = ch.take()
  thenable.then(t.fail.with(`take succeeded`)).catch(t.fail)
  thenable._op = 0
  await t.sleep(50)
})
