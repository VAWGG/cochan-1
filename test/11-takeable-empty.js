import test from './helpers'
import chan from '../src'

const NOT_YET = { desc: 'NOT_YET' }

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`non-buffered chan emits "takeable" event when it receives first send since it became empty`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()

  let events = ''
  ch.on('takeable', () => events += 't')

  await t.nextTurn()
  t.ok(events == '')

  ch.sendNow('x')
  t.ok(events == 't')

  ch.sendNow('y')
  t.ok(events == 't')

  await t.nextTurn()
  t.ok(events == 't')

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(ch.takeSync() == false)

  await t.nextTurn()
  t.ok(events == 't')

  await ch.close()
  t.ok(events == 't')
})

test(`buffered chan emits "takeable" event when it receives first send since it became empty ` +
  `(case 1)`,
async t => {
  let ch = chan(2)

  let events = ''
  ch.on('takeable', () => events += 't')

  await t.nextTurn()
  t.ok(events == '')

  t.ok(ch.sendSync('x'))
  t.ok(events == 't')

  t.ok(ch.sendSync('y'))
  t.ok(events == 't')

  ch.sendNow('z')
  t.ok(events == 't')

  await t.nextTurn()
  t.ok(events == 't')

  t.ok(ch.takeSync() && ch.value == 'x')
  t.is('y', await ch.take())
  t.ok(ch.takeSync() && ch.value == 'z')
  t.ok(ch.takeSync() == false)

  await t.nextTurn()
  t.ok(events == 't')

  await ch.close()
  t.ok(events == 't')
})

test(`buffered chan emits "takeable" event when it receives first send since it became empty ` +
  `(case 2)`,
async t => {
  let ch = chan(2)

  let events = ''
  ch.on('takeable', () => events += 't')

  await t.nextTurn()
  t.ok(events == '')

  ch.sendNow('x')
  t.ok(events == 't')

  ch.sendNow('y')
  t.ok(events == 't')

  ch.sendNow('z')
  t.ok(events == 't')

  await t.nextTurn()
  t.ok(events == 't')

  t.ok(ch.takeSync() && ch.value == 'x')
  t.is('y', await ch.take())
  t.ok(ch.takeSync() && ch.value == 'z')
  t.ok(ch.takeSync() == false)

  await t.nextTurn()
  t.ok(events == 't')

  await ch.close()
  t.ok(events == 't')
})

test(`chan doesn't emit "takeable" event when the send get immediately consumed by a pending take ` +
  `(case 1)`,
async t => {
  let ch = chan()

  let events = ''
  ch.on('takeable', () => events += 't')

  ch.take()
  await t.nextTick()

  ch.sendNow('x')
  t.ok(events == '')

  await t.nextTurn()
  t.ok(events == '')

  await ch.close()
  t.ok(events == '')
})

test(`chan doesn't emit "takeable" event when the send get immediately consumed by a pending take ` +
  `(case 2)`,
async t => {
  let ch = chan(1)

  let events = ''
  ch.on('takeable', () => events += 't')

  ch.take()
  await t.nextTick()

  t.ok(ch.sendSync('x'))
  t.ok(events == '')

  await t.nextTurn()
  t.ok(events == '')

  await ch.close()
  t.ok(events == '')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`observers of "takeable" event may have effects on the chan (sync send)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan(1)
  let maybeCanTakeSync = NOT_YET

  ch.on('takeable', () => ch.closeNow())
  ch.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanTakeSync === NOT_YET)

  t.ok(ch.sendSync('x'))
  t.ok(ch.isClosed == true)

  await t.nextTick()
  t.ok(maybeCanTakeSync == false)
})

test(`observers of "takeable" event may have effects on the chan (normal send)`, async t => {
  let ch = chan()
  let maybeCanTakeSync = NOT_YET
  let sent = NOT_YET

  ch.on('takeable', () => ch.closeNow())
  ch.maybeCanTakeSync().then(v => maybeCanTakeSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanTakeSync === NOT_YET)

  ch.send('x').then(value => sent = {value}).catch(error => sent = {error})
  await t.nextTick()

  t.ok(ch.isClosed == true)
  t.ok(sent && /closed/.test(sent.error.message))
  t.ok(maybeCanTakeSync == false)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
for (let i = 0; i < 2; ++i) {
////////////////////////////////////////////////////////////////////////////////////////////////////

let makeClosing = i == 1
let desc = makeClosing ? 'closing ' : ''

test(`non-buffered ${desc}chan emits "empty" event when all pending sends get consumed (sync take)`,
  async t => {
  let ch = chan()

  let events = ''
  ch.on('empty', () => events += 'e')

  ch.sendNow('x')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(events == 'e')

  events = ''

  ch.sendNow('y')
  ch.sendNow('z')

  if (makeClosing) {
    ch.close()
  }

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'z')
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  t.ok(ch.closeSync())
  t.ok(events == 'e')
})

test(`non-buffered ${desc}chan emits "empty" event when all pending sends get consumed (normal take)`,
async t => {
  let ch = chan()

  let events = ''
  ch.on('empty', () => events += 'e')

  ch.sendNow('x')
  t.ok(events == '')

  t.is('x', await ch.take())
  t.ok(events == 'e')

  events = ''

  ch.sendNow('y')
  ch.sendNow('z')

  if (makeClosing) {
    ch.close()
  }

  t.is('y', await ch.take())
  t.ok(events == '')

  t.is('z', await ch.take())
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  t.ok(ch.closeSync())
  t.ok(events == 'e')
})

test(`buffered ${desc}chan emits "empty" when all pending and buffered sends get consumed (sync take)`,
async t => {
  let ch = chan(2)

  let events = ''
  ch.on('empty', () => events += 'e')

  t.ok(ch.sendSync('x'))
  t.ok(ch.sendSync('y'))
  ch.sendNow('z')

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'z')
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')
})

test(`buffered ${desc}chan emits "empty" when all pending and buffered sends get consumed (normal take)`,
async t => {
  let ch = chan(2)

  let events = ''
  ch.on('empty', () => events += 'e')

  t.ok(ch.sendSync('x'))
  t.ok(ch.sendSync('y'))
  ch.sendNow('z')

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  t.is('x', await ch.take())
  t.ok(events == '')

  t.is('y', await ch.take())
  t.ok(events == '')

  t.is('z', await ch.take())
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')
})

test(`non-buffered ${desc}chan emits "empty" when the only pending send gets cancelled`, async t => {
  let ch = chan()
  let nop = () => {}

  let events = ''
  ch.on('empty', () => events += 'e')

  let cancel = ch._send('x', chan.SEND_TYPE_VALUE, nop, nop, true)

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  cancel()
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  await t.nextTurn()
  t.ok(events == 'e')
})

test(`non-buffered ${desc}chan emits "empty" when all pending sends get cancelled`, async t => {
  let ch = chan()
  let nop = () => {}

  let events = ''
  ch.on('empty', () => events += 'e')

  let cancel_x = ch._send('x', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_y = ch._send('y', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_z = ch._send('z', chan.SEND_TYPE_VALUE, nop, nop, true)

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  cancel_z()
  await t.nextTurn()
  t.ok(events == '')

  cancel_y()
  await t.nextTurn()
  t.ok(events == '')

  cancel_x()
  await t.nextTurn()
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  await t.nextTurn()
  t.ok(events == 'e')
})

test(`non-buffered ${desc}chan emits "empty" when all pending sends get consumed or cancelled (case 1)`,
async t => {
  let ch = chan()
  let nop = () => {}

  let events = ''
  ch.on('empty', () => events += 'e')

  let cancel_x = ch._send('x', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_y = ch._send('y', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_z = ch._send('z', chan.SEND_TYPE_VALUE, nop, nop, true)

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  cancel_x()
  t.ok(events == '')
  await t.nextTurn()
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(events == '')
  await t.nextTurn()
  t.ok(events == '')

  cancel_z()
  await t.nextTurn()
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  await t.nextTurn()
  t.ok(events == 'e')
})

test(`non-buffered ${desc}chan emits "empty" when all pending sends get consumed or cancelled (case 2)`,
async t => {
  let ch = chan()
  let nop = () => {}

  let events = ''
  ch.on('empty', () => events += 'e')

  let cancel_x = ch._send('x', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_y = ch._send('y', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_z = ch._send('z', chan.SEND_TYPE_VALUE, nop, nop, true)

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  cancel_x()
  t.ok(events == '')
  await t.nextTurn()
  t.ok(events == '')

  cancel_z()
  t.ok(events == '')
  await t.nextTurn()
  t.ok(events == '')

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  await t.nextTurn()
  t.ok(events == 'e')
})

test(`non-buffered ${desc}chan emits "empty" when all pending sends get consumed or cancelled (case 3)`,
async t => {
  let ch = chan()
  let nop = () => {}

  let events = ''
  ch.on('empty', () => events += 'e')

  let cancel_x = ch._send('x', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_y = ch._send('y', chan.SEND_TYPE_VALUE, nop, nop, true)
  let cancel_z = ch._send('z', chan.SEND_TYPE_VALUE, nop, nop, true)

  if (makeClosing) {
    ch.close()
  }

  await t.nextTurn()
  t.ok(events == '')

  cancel_x()
  t.ok(events == '')
  await t.nextTurn()
  t.ok(events == '')

  cancel_z()
  t.ok(events == '')
  await t.nextTurn()
  t.ok(events == '')

  t.is('y', await ch.take())
  t.ok(events == 'e')

  if (makeClosing) {
    t.ok(ch.isClosed == true)
  }

  t.ok(ch.takeSync() == false)
  t.ok(events == 'e')

  await t.nextTurn()
  t.ok(events == 'e')
})

}

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`observers of "empty" event may have effects on the chan (case 1, sync take)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let maybeCanSendSync = NOT_YET
  let drained = NOT_YET

  ch.on('empty', () => t.ok(ch.closeSync() == true))
  ch.on('drain', () => drained = true)

  ch.sendNow('x')
  t.ok(ch.write('y') == false) // trigger the need for drain

  ch.maybeCanSendSync().then(v => maybeCanSendSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(ch.isClosed == false)
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(ch.isClosed == true)
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  await t.nextTurn()
  t.ok(ch.isClosed == true)
  t.ok(maybeCanSendSync == false)
  t.ok(drained === NOT_YET)

  await t.sleep(100)
  t.ok(drained === NOT_YET)
})

test(`observers of "empty" event may have effects on the chan (case 1, normal take)`, async t => {
  let ch = chan()
  let maybeCanSendSync = NOT_YET
  let drained = NOT_YET

  ch.on('empty', () => t.ok(ch.closeSync() == true))
  ch.on('drain', () => drained = true)

  ch.sendNow('x')
  t.ok(ch.write('y') == false) // trigger the need for drain

  ch.maybeCanSendSync().then(v => maybeCanSendSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.is('x', await ch.take())
  t.ok(ch.isClosed == false)
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.is('y', await ch.take())
  t.ok(ch.isClosed == true)

  await t.nextTurn()
  t.ok(maybeCanSendSync == false)
  t.ok(drained === NOT_YET)

  await t.sleep(100)
  t.ok(drained === NOT_YET)
})

test(`observers of "empty" event may have effects on the chan (case 2, sync take)`, async t => {
  let ch = chan(1)
  let maybeCanSendSync = NOT_YET
  let drained = NOT_YET

  ch.once('empty', () => t.ok(ch.sendSync('z') == true))
  ch.on('drain', () => drained = true)

  t.ok(ch.sendSync('x') == true) // fill the buffer
  t.ok(ch.write('y') == false) // trigger the need for drain

  ch.maybeCanSendSync().then(v => maybeCanSendSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.ok(ch.takeSync() && ch.value == 'x')
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.ok(ch.takeSync() && ch.value == 'y')
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)
  t.ok(ch.canTakeSync == true)

  await t.nextTurn()
  t.ok(maybeCanSendSync == true)
  t.ok(drained === NOT_YET)
  t.ok(ch.canTakeSync == true)

  await t.sleep(100)
  t.ok(drained === NOT_YET)
  t.ok(ch.canTakeSync == true)

  t.ok(ch.takeSync() && ch.value == 'z')

  await t.nextTick()
  t.ok(drained === true)
  t.ok(ch.canTakeSync == false)
})

test(`observers of "empty" event may have effects on the chan (case 2, normal take)`, async t => {
  let ch = chan(1)
  let maybeCanSendSync = NOT_YET
  let drained = NOT_YET

  ch.once('empty', () => t.ok(ch.sendSync('z') == true))
  ch.on('drain', () => drained = true)

  t.ok(ch.sendSync('x') == true) // fill the buffer
  t.ok(ch.write('y') == false) // trigger the need for drain

  ch.maybeCanSendSync().then(v => maybeCanSendSync = v).catch(t.fail)

  await t.nextTurn()
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.is('x', await ch.take())
  t.ok(maybeCanSendSync === NOT_YET)
  t.ok(drained === NOT_YET)

  t.is('y', await ch.take())
  t.ok(drained === NOT_YET)
  t.ok(ch.canTakeSync == true)

  await t.nextTurn()
  t.ok(maybeCanSendSync == true)
  t.ok(drained === NOT_YET)
  t.ok(ch.canTakeSync == true)

  await t.sleep(100)
  t.ok(drained === NOT_YET)
  t.ok(ch.canTakeSync == true)

  t.is('z', await ch.take())
  t.ok(ch.canTakeSync == false)

  await t.nextTick()
  t.ok(drained === true)
})
