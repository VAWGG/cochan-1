import {test, scheduler} from './helpers'
import chan from '../src'

const NOT_YET = { desc: 'NOT_YET' }

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`chan.timeout(ms[, msg]) creates a special timeout chan`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  t.ok(chan.isChan(tch) == true)
  t.ok(tch.toString() == 'chan.timeout(100)')
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`timeout chan cannot be converted into a send-only one`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  t.throws(() => tch.sendOnly, /unsupported/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`timeout chan's take-only proxy is the chan itself`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  t.ok(tch.takeOnly === tch)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`timeout chan blocks until the specified timeout is reached, and after that yields an error`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  let err = NOT_YET

  tch.take()
    .then(t.fail.with(`timeout has produced a value: $$`))
    .catch(e => err = e)

  await t.nextTurn()
  t.ok(err === NOT_YET)

  await t.sleep(110)
  t.ok(err instanceof Error && /timeout/.test(err.message))
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`the optional second arg can be used to specify custom error message`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100, `alas`)
  let err = NOT_YET

  t.ok(tch.toString() == `chan.timeout(100, "alas")`)

  tch.take()
    .then(t.fail.with(`timeout has produced a value: $$`))
    .catch(e => err = e)

  await t.nextTurn()
  t.ok(err === NOT_YET)

  await t.sleep(110)
  t.ok(err instanceof Error && /alas/.test(err.message))
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`sync takes fail before timeout is reached, and throw after that`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)

  t.ok(false == tch.canTakeSync)
  t.ok(false == tch.takeSync())

  await t.nextTick()

  t.ok(false == tch.canTakeSync)
  t.ok(false == tch.takeSync())

  await t.sleep(110)

  t.ok(true == tch.canTakeSync)
  t.throws(() => tch.takeSync(), /timeout/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanTakeSync() calls block, and yield true after the timeout is reached`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  let unblockedWith = [NOT_YET, NOT_YET]

  tch.maybeCanTakeSync().then(v => unblockedWith[0] = v).catch(t.fail)
  tch.maybeCanTakeSync().then(v => unblockedWith[1] = v).catch(t.fail)

  await t.nextTurn()
  t.same(unblockedWith, [ NOT_YET, NOT_YET ])

  await t.sleep(110)
  t.same(unblockedWith, [ true, true ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`supports multiple observers`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  let errs = [NOT_YET, NOT_YET, NOT_YET]

  tch.take().catch(e => errs[0] = e)
  tch.take().catch(e => errs[1] = e)
  tch.take().catch(e => errs[2] = e)

  await t.nextTick()
  t.same(errs, [ NOT_YET, NOT_YET, NOT_YET ])

  await t.sleep(110)
  let msgs = errs.map(e => e.message)
  t.ok( msgs && msgs.every(msg => /timeout/.test(msg)) )

  await t.throws(tch.take(), /timeout/)
  t.throws(() => tch.takeSync(), /timeout/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`once the timeout is reached, the chan yields indefinite number of errors`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(0)
  await t.sleep(10)

  await t.throws(tch.take(), /timeout/)
  await t.throws(tch.take(), /timeout/)
  await t.throws(tch.take(), /timeout/)

  await t.nextTurn()

  t.throws(() => tch.takeSync(), /timeout/)
  t.throws(() => tch.takeSync(), /timeout/)
  t.throws(() => tch.takeSync(), /timeout/)

  await t.nextTurn()

  await t.throws(tch.take(), /timeout/)
  t.throws(() => tch.takeSync(), /timeout/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`is always active and cannot be sent to`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)

  t.ok(true == tch.isActive)
  t.ok(false == tch.isClosed)
  t.ok(false == tch.canSend)
  t.ok(false == tch.canSendSync)

  await t.sleep(110)

  await t.throws(tch.take(), /timeout/)
  t.throws(() => tch.takeSync(), /timeout/)

  t.ok(true == tch.isActive)
  t.ok(false == tch.isClosed)
  t.ok(false == tch.canSend)
  t.ok(false == tch.canSendSync)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`throws on all attempts to close and send a value`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)

  t.throws(() => tch.send('x'), /unsupported/)
  t.throws(() => tch.sendSync('x'), /unsupported/)
  t.throws(() => tch.close(), /unsupported/)
  t.throws(() => tch.closeSync(), /unsupported/)
  t.throws(() => tch.closeNow(), /unsupported/)

  await t.sleep(110)
  await t.throws(tch.take(), /timeout/)
  t.throws(() => tch.takeSync(), /timeout/)

  t.throws(() => tch.send('x'), /unsupported/)
  t.throws(() => tch.sendSync('x'), /unsupported/)
  t.throws(() => tch.close(), /unsupported/)
  t.throws(() => tch.closeSync(), /unsupported/)
  t.throws(() => tch.closeNow(), /unsupported/)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`#maybeCanSendSync() calls always yield true`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  t.is(true, await tch.maybeCanSendSync())
  await t.sleep(110)
  t.is(true, await tch.maybeCanSendSync())
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`(internal) supports cancellation (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  let th = tch.take()
  let err = NOT_YET

  th.catch(e => err = e)

  await t.nextTick()
  t.ok('function' == typeof th._cancel)
  th._cancel()

  await t.sleep(110)
  t.ok(err === NOT_YET)
})

test(`(internal) supports cancellation (case 2)`, async t => {
  let tch = chan.timeout(100)

  let th1 = tch.take()
  let th2 = tch.take()

  let err1 = NOT_YET
  let err2 = NOT_YET

  th1.catch(e => err1 = e)
  th2.catch(e => err2 = e)

  await t.nextTick()

  t.ok('function' == typeof th1._cancel)
  th1._cancel()

  await t.sleep(110)

  t.ok(err1 === NOT_YET)
  t.ok(err2 instanceof Error)
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test.serial(`(internal) doesn't hold resources while has no pending takes`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let tch = chan.timeout(100)
  t.ok(scheduler.scheduledCounts.timeout == 0)

  let th = tch.take()
  await t.nextTick()

  t.ok(scheduler.scheduledCounts.timeout == 1)

  th._cancel()
  t.ok(scheduler.scheduledCounts.timeout == 0)

  await t.sleep(110)
  scheduler.onScheduled((fn, type, id) => {
    if (type == 'timeout') {
      t.fail(`new timeout task was added: ${fn}`)
    }
  })

  t.throws(() => tch.takeSync(), /timeout/)
  await t.throws(tch.take(), /timeout/)
})
