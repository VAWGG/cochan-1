import avaTest from 'ava'
export default test

let defaultTimeout = 5000

exec(_ => {
  let descs = {}
  Object.getOwnPropertyNames(avaTest).forEach(prop => {
    descs[prop] = Object.getOwnPropertyDescriptor(avaTest, prop)
  })
  Object.defineProperties(test, descs)
})

export function test() {
  let desc, timeoutMs, fn
  for (let i = 0; i < arguments.length; ++i) {
    let arg = arguments[i]
    switch (typeof arg) {
      case 'string': desc = arg; break
      case 'number': timeoutMs = arg; break
      case 'function': fn = arg; break
    }
  }
  fn = withTimeout(timeoutMs || defaultTimeout, fn)
  if (desc) {
    avaTest(desc, fn)
  } else {
    avaTest(fn)
  }
}

test.timeout = function timeout(ms) {
  defaultTimeout = ms
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function consume(ch, values = []) {
  while (chan.CLOSED != await ch.take()) {
    values.push(ch.value)
  }
  return values
}

export function exec(fn) {
  return fn()
}

function withTimeout(ms, fn) {
  return t => new Promise((resolve, reject) => {
    let tid = setTimeout(fail, ms)
    function fail() {
      tid = undefined
      reject(new Error(`test failed to complete in ${ms} ms`))
    }
    function success(v) {
      if (tid == undefined) return
      clearTimeout(tid)
      resolve(v)
    }
    fn(bindAssertions(t)).then(success).catch(reject)
  })
}

const assertions = ['pass', 'fail', 'ok', 'notOk', 'true', 'false']

function bindAssertions(t) {
  for (let i = 0; i < assertions.length; ++i) {
    let name = assertions[i]
    let orig = t[name]
    t[name] = function boundAssertion(){ return orig.apply(t, arguments) }
  }
  t.sleep = sleep
  t.consume = t$consume
  return t
}

function t$consume(t, ch) {
  t.consumed = []
  return consume(ch, t.consumed)
}
