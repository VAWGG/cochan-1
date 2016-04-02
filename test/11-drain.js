import test from './helpers'
import chan from '../src'

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`drain event is emitted on take, when the chan has the ability to send sync AND ` +
  `needsDrain flag is set (non-buffered)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  let events = ''
  ch.on('drain', () => events += 'd')

  ch.sendNow('x')
  ch.sendNow('y')
  ch.setNeedsDrain()

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(events == '')

  t.ok(ch.takeSync() == false)
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')

  ch.take()
  await t.nextTick()
  t.ok(events == 'd')

  ch.take()
  await t.nextTick()
  t.ok(events == 'd')

  ch.setNeedsDrain()
  ch.take()
  await t.nextTick()
  t.ok(events == 'dd')

  await t.sleep(100)
  t.ok(events == 'dd')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`drain event is emitted on sync take, when the chan has the ability to send sync AND ` +
  `needsDrain flag is set (buffered)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(3)

  let events = ''
  ch.on('drain', () => events += 'd')
  ch.setNeedsDrain()

  t.ok(ch.sendSync('a'))
  t.ok(ch.sendSync('b'))
  t.ok(ch.sendSync('c'))
  t.ok(events == '')

  ch.sendNow('d')
  ch.sendNow('e')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'a')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'b')
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'c')
  t.ok(events == 'd')

  t.ok(ch.takeSync() && ch.value == 'd')
  t.ok(events == 'd')

  ch.setNeedsDrain()
  t.ok(ch.takeSync() && ch.value == 'e')
  t.ok(events == 'dd')

  ch.take()
  await t.nextTick()
  t.ok(events == 'dd')

  ch.setNeedsDrain()
  ch.take()
  await t.nextTick()
  t.ok(events == 'ddd')

  await t.sleep(100)
  t.ok(events == 'ddd')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`drain event is emitted on normal take, when the chan has the ability to send sync AND ` +
  `needsDrain flag is set (buffered)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(3)

  let events = ''
  ch.on('drain', () => events += 'd')
  ch.setNeedsDrain()

  t.ok(ch.sendSync('a'))
  t.ok(ch.sendSync('b'))
  t.ok(ch.sendSync('c'))
  t.ok(events == '')

  ch.sendNow('d')
  ch.sendNow('e')
  t.ok(events == '')

  t.is('a', await ch.take())
  t.ok(events == '')

  t.is('b', await ch.take())
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')

  t.is('c', await ch.take())
  t.ok(events == 'd')

  t.is('d', await ch.take())
  t.ok(events == 'd')

  ch.setNeedsDrain()
  t.is('e', await ch.take())
  t.ok(events == 'dd')

  ch.take()
  await t.nextTick()
  t.ok(events == 'dd')

  ch.setNeedsDrain()
  ch.take()
  await t.nextTick()
  t.ok(events == 'ddd')

  await t.sleep(100)
  t.ok(events == 'ddd')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`drain event is not emitted when needsDrain flag is not set`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  t.ok(ch.sendSync('x'))

  let events = ''
  ch.on('drain', () => events += 'd')

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(events == '')

  t.ok(ch.takeSync() == false)
  t.ok(events == '')

  ch.take()

  await t.sleep(100)
  t.ok(events == '')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`drain event is not emitted as a result on non-take actions`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(10)

  let events = ''
  ch.on('drain', () => events += 'd')

  ch.setNeedsDrain()
  t.ok(events == '')

  t.is(true, await ch.maybeCanSendSync())
  t.ok(events == '')

  ch.maybeCanTakeSync()
  t.ok(events == '')

  t.ok(ch.sendSync('x'))
  t.ok(events == '')

  t.ok(ch.sendSync('y'))
  t.ok(events == '')

  t.is(true, await ch.maybeCanTakeSync())
  t.ok(events == '')

  t.is(true, await ch.maybeCanSendSync())
  t.ok(events == '')

  ch.close()
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')

  ch.closeNow()
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`needsDrain flag gets automatically set on a Streams3 write that returned false`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)

  let events = ''
  ch.on('drain', () => events += 'd')

  t.ok(ch.write('x') == true)
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')

  t.ok(ch.write('y') == false)
  t.ok(events == '')

  await t.sleep(100)
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'x')
  await t.sleep(100)
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(events == 'd')

  await t.sleep(100)
  t.ok(events == 'd')
})
