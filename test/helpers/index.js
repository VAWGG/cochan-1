import _test from 'ava'
export default test

let defaultTimeout = +(process.env.TEST_TIMEOUT || 5000)

export function test(a1, a2, a3) {
  declareTest(null, a1, a2, a3)
}

test.only = function only(a1, a2, a3) {
  declareTest('only', a1, a2, a3)
}

test.timeout = function timeout(ms) {
  defaultTimeout = ms
}

exec(_ => {
  let descs = {}
  Object.getOwnPropertyNames(_test).forEach(prop => {
    if (prop == 'only') return
    descs[prop] = Object.getOwnPropertyDescriptor(_test, prop)
  })
  Object.defineProperties(test, descs)
})

function declareTest(mod, a1, a2, a3) {
  let args = [a1, a2, a3]
  let desc, timeoutMs, fn
  for (let i = 0; i < 3; ++i) {
    let arg = args[i]
    switch (typeof arg) {
      case 'string': desc = arg; break
      case 'number': timeoutMs = arg; break
      case 'function': fn = arg; break
    }
  }
  fn = withTimeout(timeoutMs || defaultTimeout, fn)
  let test = mod ? _test[mod] : _test
  if (desc) {
    test(desc, fn)
  } else {
    test(fn)
  }
}

export function nop() {}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function nextTick() {
  return new Promise(resolve => process.nextTick(resolve))
}

export function nextTurn() {
  return new Promise(resolve => setImmediate(resolve))
}

export async function consume(ch, values = []) {
  while (chan.CLOSED != await ch.take()) {
    values.push(ch.value)
  }
  return values
}

export async function consumeSync(ch, values = []) {
  while (ch.takeSync()) {
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

function bindAssertions(t) {
  let pass = t.pass
  let fail = t.fail
  Object.defineProperty(t, 'fail', {
    get: () => {
      let err = new Error()
      function failBound() {
        return arguments.length == 1 && arguments[0] instanceof Error
          ? fail.call(t, combineStacks(err, arguments[0]))
          : fail.apply(t, arguments)
      }
      failBound.with = t$failWith
      return failBound
    }
  })
  t.pass = v => pass.call(t, v)
  t.sleep = sleep
  t.nextTick = nextTick
  t.nextTurn = nextTurn
  t.nop = nop
  t.consume = t$consume
  t.consumeSync = t$consumeSync
  t.ctx = t.context
  return t
}

function t$consume(ch, concat) {
  return consume(ch, this.consumed = [])
}

function t$consumeSync(ch, concat) {
  return consumeSync(ch, this.consumed = [])
}

function t$failWith(msg) {
  let fail = this
  return function() {
    let i = 0
    let fullMsg = msg.replace(/\$(\d+|\$)/g, (_, d) => {
      let obj = arguments[d == '$' ? i++ : +d]
      return obj instanceof Error ? obj.stack : obj
    })
    fail(fullMsg)
  }
}

const NATIVE_FRAME_RE = /child_process[.]js|events[.]js|\(native\)/
const AVA_FRAME_RE = /node_modules[/](?:ava|bluebird|empower-core|babel-runtime|core-js)/
const IGNORE_FRAME_RE = reOr(NATIVE_FRAME_RE, AVA_FRAME_RE, 'helpers/index.js')

function combineStacks(failErr, err) {
  let lines = failErr.stack.split('\n')
  lines.shift(); lines.shift()
  lines = lines.filter(l => !IGNORE_FRAME_RE.test(l))
  err.message = err.stack + '\nAt assertion:\n' + lines.join('\n')
  err.toString = () => err.message
  err.stack = err.message
  return err
}

function reOr(...regexps) {
  return new RegExp(regexps.map(wrapInREGroup).join('|'))
}

function wrapInREGroup(re) {
  return `(?:${ re instanceof RegExp ? re.source : re })`
}
