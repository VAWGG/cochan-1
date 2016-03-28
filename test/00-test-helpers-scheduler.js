import test from 'ava'
import Scheduler from './helpers/scheduler'

const nop = () => {}

const sleepTurns = (N) => new Promise(resolve => {
  let n = -1
  let next = () => ++n == N ? resolve() : setImmediate(next)
  next()
})

test.beforeEach(t => {
  let ctx = t.context
  let sc = new Scheduler()

  ctx.sc = sc
  ctx.executions = []
  ctx.startTick = sc.now()

  ctx.logExecutions = (name, fn) => function() {
    ctx.executions.push(`${ name }(${ sc.now() - ctx.startTick })`)
    fn && fn.apply(this, arguments)
  }

  ctx.expectExecutions = (t, expected) => new Promise(res => sc.whenDone(res)).then(() => {
    if (typeof expected == 'function') {
      expected = expected()
    }
    t.same(ctx.executions, expected)
    ctx.executions = []
    ctx.startTick = sc.now()
  })

  ctx.clearExecutions = () => {
    ctx.executions = []
  }
})

function callTimes(times, fn) {
  let numCalls = 0
  return function(){ if (++numCalls <= times) return fn.apply(this, arguments) }
}

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`provides #whenDone() function that runs all callbacks in order as soon as the last ` +
  `scheduled execution ends`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc} = t.context
  let evts = []

  let aIntvId = sc.setInterval(() => evts.push('a'), 10)
  sc.setTimeout(() => { evts.push('b'); sc.clearInterval(aIntvId) }, 25)
  sc.whenDone(() => evts.push('done'))

  await new Promise(resolve => sc.whenDone(resolve))
  t.same(evts, [ 'a', 'a', 'b', 'done' ])
})

test(`#whenDone() works correctly (setImmediate)`, async t => {
  let {sc} = t.context
  let evts = []

  sc.setImmediate(() => evts.push('i'))
  sc.whenDone(() => evts.push('done'))

  await new Promise(resolve => sc.whenDone(resolve))
  t.same(evts, [ 'i', 'done' ])
})

test(`#whenDone() works correctly (nextTick)`, async t => {
  let {sc} = t.context
  let evts = []

  sc.nextTick(() => evts.push('n'))
  sc.whenDone(() => evts.push('done'))

  await new Promise(resolve => sc.whenDone(resolve))
  t.same(evts, [ 'n', 'done' ])
})

test(`#whenDone() works correctly (nextTick added by setImmediate)`, async t => {
  let {sc} = t.context
  let evts = []

  sc.setImmediate(() => {
    evts.push('i')
    sc.nextTick(() => evts.push('n'))
  })

  sc.whenDone(() => evts.push('done'))

  await new Promise(resolve => sc.whenDone(resolve))
  t.same(evts, [ 'i', 'n', 'done' ])
})

test(`#whenDone() works correctly (setImmediate added by nextTick)`, async t => {
  let {sc} = t.context
  let evts = []

  sc.nextTick(() => {
    evts.push('n')
    sc.setImmediate(() => evts.push('i'))
  })

  sc.whenDone(() => evts.push('done'))

  await new Promise(resolve => sc.whenDone(resolve))
  t.same(evts, [ 'n', 'i', 'done' ])
})

test(`#whenDone() works correctly (sync cancel)`, async t => {
  let {sc} = t.context
  let evts = []

  let id_t = sc.setTimeout(() => evts.push('t'), 0)
  let id_i = sc.setInterval(() => evts.push('i'), 0)
  let id_m = sc.setImmediate(() => evts.push('m'))

  sc.clearInterval(id_i)
  sc.clearImmediate(id_m)
  sc.clearTimeout(id_t)

  sc.whenDone(() => evts.push('done'))

  await new Promise(resolve => sc.whenDone(resolve))
  t.same(evts, [ 'done' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`when there are no scheduled executions, #whenDone() runs all callbacks synchronously`, t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc} = t.context
  let evts = []

  sc.whenDone(() => evts.push('a'))
  sc.whenDone(() => evts.push('b'))

  t.same(evts, [ 'a', 'b' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`provides setTimeout and setInterval functions that guarantee in-order execution`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  sc.setTimeout(logExecutions('h1'), 3)
  sc.setTimeout(logExecutions('h2'), 3)

  sc.setTimeout(logExecutions('f1'), 1)
  sc.setTimeout(logExecutions('f2'), 1)

  sc.setTimeout(logExecutions('g1'), 2)
  sc.setTimeout(logExecutions('g2'), 2)

  await expectExecutions(t, [
    "f1(1)", "f2(1)",
    "g1(2)", "g2(2)",
    "h1(3)", "h2(3)"
  ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`given zero delay, runs function in the next tick`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  sc.setTimeout(logExecutions('f'), 1)
  sc.setTimeout(logExecutions('g'), 0)
  sc.setTimeout(logExecutions('h'), 0)

  await expectExecutions(t, [ "f(1)", "g(1)", "h(1)" ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows to call setTimeout during another setTimeout execution`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  // the same function is scheduled each time
  let f = logExecutions('f', callTimes(2, () => { sc.setTimeout(f, 1) }))

  // a different function is scheduled each time
  let g = logExecutions('g', callTimes(2, () => {
    let next = () => g()
    sc.setTimeout(next, 1)
  }))

  sc.setTimeout(f, 1)
  sc.setTimeout(g, 1)

  await expectExecutions(t, [
    "f(1)", "g(1)",
    "f(2)", "g(2)",
    "f(3)", "g(3)"
  ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`provides clearTimeout and clearInterval functions to cancel scheduled execution`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let tL = sc.setTimeout(logExecutions('l'), 3)
  let iF = sc.setInterval(logExecutions('f'), 0)
  let tG = sc.setTimeout(logExecutions('g'), 0)
  let tH = sc.setTimeout(logExecutions('h'), 3)

  sc.clearInterval(iF)
  sc.clearTimeout(tL)

  await expectExecutions(t, [ "g(1)", "h(3)" ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows to call clearTimeout and clearInterval during setTimeout execution`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let f = logExecutions('f', () => {
    sc.clearInterval(gIntvId)
    sc.clearTimeout(hTmId)
  })

  sc.setTimeout(f, 3)

  let gIntvId = sc.setInterval(logExecutions('g'), 0)
  let hTmId = sc.setTimeout(logExecutions('h'), 4)

  await expectExecutions(t, [ "g(1)", "g(2)", "f(3)" ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows to call clearTimeout and clearInterval during setInterval execution`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let fNumCalls = 0
  let fIntvId, gIntvId, hTmId

  let f = logExecutions('f', () => {
    if (++fNumCalls == 3) {
      sc.clearInterval(fIntvId)
      sc.clearInterval(gIntvId)
      sc.clearTimeout(hTmId)
    }
  })

  fIntvId = sc.setInterval(f, 2)
  gIntvId = sc.setInterval(logExecutions('g'), 1)

  hTmId = sc.setTimeout(logExecutions('h'), 9)

  await expectExecutions(t, [
    "g(1)",
    "f(2)", "g(2)",
    "g(3)",
    "f(4)", "g(4)",
    "g(5)",
    "f(6)"
  ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`works within complex timeouts setup`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions, startTick} = t.context

  let actions = [
    { tick: 0,
      schedule: { f1: 2, f2: 5, f3: 2 },
      clear: { f1: true }
    }, // [f3: 2], f2: 5
    { tick: 3,
      schedule: { f4: 5, f5: 7, f6: 8 },
      clear: { f2: true }
    }, // [f4: 5], f5: 7, f6: 8
    { tick: 6,
      schedule: { f7: 7, f8: 7, f9: 10, f10: 15, f11: 10 },
      clear: { f8: true, f6: true }
    }, // [f5: 7, f7: 7], f9: 10, f11: 10, f10: 15
    { tick: 9,
      schedule: { f12: 15, f13: 17, f14: 11 },
      clear: { f9: true, f11: true }
    } // [f14: 11, f10: 15, f12: 15, f13: 17]
  ]

  let nextAction = (() => {
    let i = 0
    let idsByFName = {}
    return () => {
      let { schedule, clear } = actions[i]
      let currentTick = sc.now() - startTick
      Object.keys(schedule).forEach(fName => {
        let tick = schedule[fName]
        idsByFName[fName] = sc.setTimeout(logExecutions(fName), tick - currentTick)
      })
      Object.keys(clear).forEach(fName => {
        sc.clearTimeout(idsByFName[fName])
      })
      if (++i < actions.length) {
        sc.setTimeout(nextAction, actions[i].tick - currentTick)
      }
    }
  })()

  nextAction()

  await expectExecutions(t, [
    "f3(2)", "f4(5)", "f5(7)", "f7(7)", "f14(11)", "f10(15)", "f12(15)", "f13(17)"
  ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`does nothing when clearInterval/clearTimeout is called with an invalid/outdated id`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let outdatedId = sc.setTimeout(logExecutions('outdated'), 0)
  sc.clearTimeout(outdatedId)

  let i = logExecutions('i', () => {
    sc.clearTimeout(outdatedId)
    sc.clearInterval(outdatedId)
    sc.clearTimeout(-1)
    sc.clearInterval(-1)
    sc.clearTimeout(10000000)
    sc.clearInterval(10000000)
    sc.clearTimeout('ururu')
    sc.clearInterval(`what's this?`)
  })

  let intvId
  let tm = logExecutions('t', () => sc.clearInterval(intvId))

  sc.setTimeout(tm, 100)
  intvId = sc.setInterval(i, 30)

  await expectExecutions(t, [ "i(30)", "i(60)", "i(90)", "t(100)" ])
})

test(`does nothing when clear functions are called with an id of another task type`, async t => {
  let {sc, logExecutions, expectExecutions} = t.context

  let id_t = sc.setTimeout(logExecutions('t'), 0)
  let id_i = sc.setInterval(logExecutions('i', () => sc.clearInterval(id_i)), 0)
  let id_m = sc.setImmediate(logExecutions('m'))

  sc.clearTimeout(id_i)
  sc.clearTimeout(id_m)

  sc.clearInterval(id_t)
  sc.clearInterval(id_m)

  sc.clearImmediate(id_t)
  sc.clearImmediate(id_i)

  await expectExecutions(t, [ 'm(1)', 't(1)', 'i(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows scheduling in multiple runs`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  // run 0

  sc.setTimeout(logExecutions('x'), 5)
  sc.setTimeout(logExecutions('y'), 1)

  await expectExecutions(t, [ 'y(1)', 'x(5)' ])

  // run 1

  let aId, aRuns = 0, a = logExecutions('a', () => {
    if (++aRuns == 3) sc.clearInterval(aId)
  })

  aId = sc.setInterval(a, 5)
  await expectExecutions(t, [ 'a(5)', 'a(10)', 'a(15)' ])

  // run 2

  let bId

  sc.setTimeout(logExecutions('c', () => { sc.clearInterval(bId) }), 9)
  bId = sc.setInterval(logExecutions('b'), 3)

  await expectExecutions(t, [ 'b(3)', 'b(6)', 'c(9)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`provides setImmediate function that runs its callbacks before the ones of zero-delayed ` +
  `setTimeout`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  sc.setTimeout(logExecutions('t1'), 0)
  sc.setImmediate(logExecutions('i1'), 0)
  sc.setImmediate(logExecutions('i2'), 0)
  sc.setTimeout(logExecutions('t2'), 0)

  await expectExecutions(t, [ 'i1(1)', 'i2(1)', 't1(1)', 't2(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`setImmediate recursion doesn't prevent setTimeout callbacks from running`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let iN = 0, iRecur = logExecutions('i', () => {
    if (++iN < 3) sc.setImmediate(iRecur)
  })

  let tN = 0, tRecur = logExecutions('t', () => {
    if (++tN < 3) sc.setTimeout(tRecur, 0)
  })

  iRecur()
  tRecur()

  await expectExecutions(t, [ 'i(0)', 't(0)', 'i(1)', 't(1)', 'i(2)', 't(2)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows to cancel setImmediate callback using clearImmediate function`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let iid = sc.setImmediate(logExecutions('i'))
  sc.setImmediate(logExecutions('j'))
  sc.clearImmediate(iid)

  await expectExecutions(t, [ 'j(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows calling setImmediate from callbacks of setTimeout and setImmediate`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let addImmediate = name => sc.setImmediate(logExecutions(name))

  sc.setTimeout(logExecutions('t', () => addImmediate('ti')), 0)
  sc.setImmediate(logExecutions('i', () => addImmediate('ii')))

  await expectExecutions(t, [ 'i(1)', 't(1)', 'ii(2)', 'ti(2)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows calling clearImmediate from callbacks of setTimeout and setImmediate (case 1)`,
  async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context
  let iid1, iid2

  sc.setImmediate(logExecutions('c1', () => sc.clearImmediate(iid1)))
  sc.setTimeout(logExecutions('c2', () => sc.clearImmediate(iid2)), 3)

  iid1 = sc.setImmediate(logExecutions('i1'))

  let i2 = logExecutions('i2', () => { iid2 = sc.setImmediate(i2) })
  sc.setImmediate(i2)

  await expectExecutions(t, [ 'c1(1)', 'i2(1)', 'i2(2)', 'i2(3)', 'c2(3)' ])
})

test(`allows calling clearImmediate from callbacks of setTimeout and setImmediate (case 2)`,
async t => {
  let {sc, logExecutions, expectExecutions} = t.context
  let iid1, iid2

  sc.setImmediate(logExecutions('c1', () => {
    sc.clearImmediate(iid1)
    iid2 = sc.setImmediate(logExecutions('i2'))
  }))

  iid1 = sc.setImmediate(logExecutions('i1'))
  sc.setTimeout(logExecutions('c2', () => sc.clearImmediate(iid2)))

  await expectExecutions(t, [ 'c1(1)', 'c2(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`provides nextTick function that runs its callbacks before all other ones`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  sc.setTimeout(logExecutions('t'))
  sc.setImmediate(logExecutions('i'))
  sc.nextTick(logExecutions('n'))

  await expectExecutions(t, [ 'n(0)', 'i(1)', 't(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`nextTick callbacks added inside a tick run at its end (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  sc.setImmediate(logExecutions('i1', () => {
    sc.nextTick(logExecutions('n'))
  }))

  sc.setImmediate(logExecutions('i2'))
  
  await expectExecutions(t, [ 'i1(1)', 'i2(1)', 'n(1)' ])
})

test(`nextTick callbacks added inside a tick run at its end (case 2)`, async t => {
  let {sc, logExecutions, expectExecutions} = t.context
  let nN = 0, nRecur

  nRecur = logExecutions('n', () => {
    if (++nN < 3) sc.nextTick(nRecur)
  })

  sc.setImmediate(logExecutions('i', nRecur))

  await expectExecutions(t, [ 'i(1)', 'n(1)', 'n(1)', 'n(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`nextTick recursion _does_ prevent other callbacks from running`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  sc.setImmediate(logExecutions('i'))
  sc.setTimeout(logExecutions('t'), 0)

  let nN = 0, nRecur = logExecutions('n', () => {
    if (++nN < 3) sc.nextTick(nRecur)
  })

  nRecur()

  await expectExecutions(t, [ 'n(0)', 'n(0)', 'n(0)', 'i(1)', 't(1)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows calling clearImmediate and clearTimeout from callbacks of nextTick`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  let tid = sc.setTimeout(logExecutions('t'), 0)
  let iid = sc.setImmediate(logExecutions('i'))

  sc.nextTick(logExecutions('n', () => {
    sc.clearImmediate(iid)
    sc.clearTimeout(tid)
  }))

  await expectExecutions(t, [ 'n(0)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows to get number of currently scheduled tasks using #scheduledCounts prop`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 0 })

  let tm_1 = sc.setTimeout(nop, 0)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 1, interval: 0 })

  let in_1 = sc.setInterval(nop, 0)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 1, interval: 1 })

  sc.clearTimeout(tm_1)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 1 })

  sc.clearTimeout(tm_1)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 1 })

  await sleepTurns(5)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 1 })

  sc.clearInterval(in_1)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 0 })

  sc.clearInterval(in_1)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 0 })

  await sleepTurns(5)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 0 })

  let im_1 = sc.setImmediate(nop)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 1, timeout: 0, interval: 0 })

  sc.nextTick(nop)
  t.same(sc.scheduledCounts, { microtask: 1, macrotask: 1, timeout: 0, interval: 0 })

  sc.nextTick(nop)
  t.same(sc.scheduledCounts, { microtask: 2, macrotask: 1, timeout: 0, interval: 0 })

  sc.setImmediate(nop)
  t.same(sc.scheduledCounts, { microtask: 2, macrotask: 2, timeout: 0, interval: 0 })

  sc.clearImmediate(im_1)
  t.same(sc.scheduledCounts, { microtask: 2, macrotask: 1, timeout: 0, interval: 0 })

  sc.clearImmediate(im_1)
  t.same(sc.scheduledCounts, { microtask: 2, macrotask: 1, timeout: 0, interval: 0 })

  sc.setTimeout(nop, 0)
  t.same(sc.scheduledCounts, { microtask: 2, macrotask: 1, timeout: 1, interval: 0 })

  sc.setTimeout(nop, 0)
  t.same(sc.scheduledCounts, { microtask: 2, macrotask: 1, timeout: 2, interval: 0 })

  await sleepTurns(5)
  t.same(sc.scheduledCounts, { microtask: 0, macrotask: 0, timeout: 0, interval: 0 })
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`allows to register new tasks observer using #onScheduled() function`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context
  let tasks = []

  function T() { t.fail(`T() was called`) }
  function I() { t.fail(`I() was called`) }
  function M() { t.fail(`M() was called`) }
  function m() {}

  sc.onScheduled((fn, type, id) => {
    tasks.push(`${type}(${fn.name})`)
    switch (type) {
      case 'macrotask': sc.clearImmediate(id); break
      case 'timeout': sc.clearTimeout(id); break
      case 'interval': sc.clearInterval(id); break
    }
  })

  t.same(tasks, [])

  sc.setTimeout(T, 0)
  sc.setInterval(I, 0)
  sc.setImmediate(M)
  sc.nextTick(m)

  t.same(tasks, [ 'timeout(T)', 'interval(I)', 'macrotask(M)', 'microtask(m)' ])
  await sleepTurns(5)
  t.same(tasks, [ 'timeout(T)', 'interval(I)', 'macrotask(M)', 'microtask(m)' ])
})

////////////////////////////////////////////////////////////////////////////////////////////////////
test(`interoperates with native (real) microtasks (case 1)`, async t => {
////////////////////////////////////////////////////////////////////////////////////////////////////
  let {sc, logExecutions, expectExecutions} = t.context

  // check spec-compliance for native impl

  let execs = []
  let resolve, p = new Promise(r => resolve = r)

  setImmediate(() => { execs.push('M1'); resolve() })
  p.then(() => execs.push('m'))
  setImmediate(() => execs.push('M2'))

  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))

  t.same(execs, [ 'M1', 'M2', 'm' ])

  // check scheduler impl

  execs = []
  p = new Promise(r => resolve = r)

  sc.setImmediate(() => { execs.push('M1'); resolve() })
  p.then(() => execs.push('m'))
  sc.setImmediate(() => execs.push('M2'))

  await new Promise(r => sc.whenDone(r))
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))

  t.same(execs, [ 'M1', 'M2', 'm' ])
})

test(`interoperates with native (real) microtasks (case 2)`, async t => {
  let {sc, logExecutions, expectExecutions} = t.context

  // check spec-compliance for native impl

  let execs = []
  let resolve, p = new Promise(r => resolve = r)

  setImmediate(() => { execs.push('M'); resolve() })
  p.then(() => execs.push('m1'))
  Promise.resolve().then(() => execs.push('m2'))

  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))

  t.same(execs, [ 'm2', 'M', 'm1' ])

  // check scheduler impl

  execs = []
  p = new Promise(r => resolve = r)

  sc.setImmediate(() => { execs.push('M'); resolve() })
  p.then(() => execs.push('m1'))
  sc.nextTick(() => execs.push('m2'))

  await new Promise(r => sc.whenDone(r))
  await new Promise(r => setImmediate(r))
  await new Promise(r => setImmediate(r))

  t.same(execs, [ 'm2', 'M', 'm1' ])
})
