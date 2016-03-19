import test from './helpers'
import chan from '../src'

test.timeout(1000)

test('#send(value) can be called on a newly created channel', async t => {
  let ch = chan()
  ch.send(1)
})

test('#take() can be called on a newly created channel', async t => {
  let ch = chan()
  ch.take()
})

test('#send(value) sends a value to a channel, and #take() receives it', async t => {
  let ch = chan()
  ch.send(7)
  let value = await ch.take()
  t.is(value, 7)
})

test('#send() blocks until the value is sent', async t => {
  let ch = chan()
  let isSent = false
  ch.send('x').then(_ => isSent = true).catch(t.fail)
  t.false(isSent)
  await ch.take()
  await t.sleep(0)
  t.true(isSent)
})
