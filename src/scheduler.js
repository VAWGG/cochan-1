// https://github.com/petkaantonov/bluebird/blob/master/src/schedule.js
// https://github.com/petkaantonov/bluebird/blob/master/src/util.js

const isNode = 'undefined' !== typeof process
  && '[object process]' === {}.toString.call(process).toLowerCase()

const scheduler = {
  schedule: undefined
}

export default scheduler

if (isNode) {
  const version = process.versions.node.split('.').map(Number)
  const isRecentNode = (version[0] > 0) || (version[0] === 0 && version[1] > 10)
  if (isRecentNode) {
    scheduler.schedule = setImmediate
  } else {
    let nextTick = process.nextTick
    scheduler.schedule = (fn) => { nextTick.call(process, fn) }
  }
} else if ('undefined' !== typeof setImmediate) {
  scheduler.schedule = setImmediate
} else {
  scheduler.schedule = (fn) => { setTimeout(fn, 0) }
}
