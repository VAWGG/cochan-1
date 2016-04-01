import test from '../helpers'
import chan from '../../src'
import {SEND_TYPE_INTENT, ERROR} from '../../src/constants'

const NOT_YET = {}

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#_send can accept intents`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let intent = () => 42

  let sent = NOT_YET
  let onSent = v => sent = v

  ch._send(intent, SEND_TYPE_INTENT, onSent, t.fail.with(`send failed`), false)

  await t.nextTurn()
  t.ok(sent === NOT_YET)

  t.ok(ch.canTakeSync == true)
  t.ok(ch.takeSync() && ch.value == 42)
  t.ok(sent == 42)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`intents can yield errors`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let err = new Error('ururu')
  let intent = () => { ERROR.value = err; return ERROR }

  let sent = NOT_YET
  let onSent = v => sent = v

  ch._send(intent, SEND_TYPE_INTENT, onSent, t.fail.with(`send failed`), false)

  await t.nextTurn()
  t.ok(sent === NOT_YET)

  t.ok(ch.canTakeSync == true)
  t.throws(() => ch.takeSync(), /ururu/)
  t.ok(sent === err)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`intents can be cancelled`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let ch = chan()
  let intent = () => 42

  let sent = NOT_YET
  let onSent = v => sent = v

  let cancel = ch._send(intent, SEND_TYPE_INTENT, onSent, t.fail.with(`send failed`), true)

  await t.nextTurn()
  t.ok(sent === NOT_YET)

  cancel()

  t.ok(ch.canTakeSync == false)
  t.ok(ch.takeSync() == false)
  t.ok(sent == NOT_YET)

  await t.nextTurn()

  t.ok(ch.canTakeSync == false)
  t.ok(ch.takeSync() == false)
  t.ok(sent == NOT_YET)
})
