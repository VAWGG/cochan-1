import test from '../helpers'
import chan from '../../src'

test.timeout(1000)

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
  thenable._op = 0
  ch.take().then(t.fail.with(`take succeeded: $$`)).catch(t.fail)
  await t.sleep(100)
})
