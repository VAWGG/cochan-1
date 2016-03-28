// This code is partially taken from:
// https://github.com/petkaantonov/bluebird/blob/master/src/schedule.js
// https://github.com/petkaantonov/bluebird/blob/master/src/util.js

const isNode = 'undefined' !== typeof process
  && '[object process]' === {}.toString.call(process).toLowerCase()

const schedule = {
  // See: https://github.com/YuzuJS/setImmediate/blob/master/README.md#macrotasks-and-microtasks
  macrotask: undefined,
  microtask: undefined,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  now: typeof Date.now == 'function' ? () => Date.now() : () => +new Date()
}

export default schedule

if (isNode) {
  // See: https://github.com/nodejs/node/wiki/API-changes-between-v0.8-and-v0.10
  // See: https://github.com/nodejs/node-v0.x-archive/pull/8325
  const processNextTick = process.nextTick
  const nextTick = (fn) => { processNextTick.call(process, fn) }
  if ('function' === typeof setImmediate) {
    // In Node.js v0.10 and later, setImmediate enqueues a macrotask
    schedule.macrotask = setImmediate
    // and process.nextTick enqueues a microtask
    schedule.microtask = nextTick
  } else {
    // In Node.js v0.8 and earlier, process.nextTick enqueues a macrotask
    schedule.macrotask = nextTick
    // and those ancient Nodes have no notion of microtask queue, so we
    // have no other option than to use process.nextTick here too
    schedule.microtask = nextTick
  }
} else if ('function' === typeof setImmediate) {
  // setImmediate always enqueues a macrotask, per spec
  schedule.macrotask = setImmediate
  // But, since we don't want to deal with mutation observers
  // and so on, we use it for microtasks too. This increases
  // latency, but requires much less code.
  schedule.microtask = setImmediate
} else {
  // When setImmediate is not available, use setTimeout both
  // for macro- and microtasks.
  schedule.macrotask = (fn) => { setTimeout(fn, 0) }
  schedule.microtask = schedule.macrotask
}
