const pResolved = Promise.resolve()

const nativeNextTick = typeof process != 'undefined' && typeof process.nextTick == 'function'
  ? fn => process.nextTick(fn)
  : fn => pResolved.then(fn)

const nativeNextTurn = typeof setImmediate == 'function'
  ? setImmediate
  : fn => setTimeout(fn, 0)


const TYPE_MACRO = 0
const TYPE_TIMEOUT = 1
const TYPE_INTERVAL = 2


export default class Scheduler {

  constructor(maxIntervalRuns = 1000) {
    this._maxIntervalRuns = maxIntervalRuns
    this._lastTaskId = -1
    this._nextTurnScheduled = false
    this._startTime = Date.now()
    this._currentTurn = 0
    this._currentTurnDesc = undefined
    this._doneObservers = []
    this._schedule = []
    this._scheduledTicks = {}
    this._scheduledTaskIds = {}
    this._removedTaskIds = {}
    this._newTaskObservers = []
    this._bindFns()
    this._numScheduled = { microtask: 0, macrotask: 0, timeout: 0, interval: 0 }
  }

  _bindFns() {
    this.now = () => this._startTime + this._currentTurn
    this.nextTick = (fn) => this._scheduleMicrotask(fn)
    this.setImmediate = (fn) => this._add(0, TYPE_MACRO, { fn })
    this.clearImmediate = (id) => this._remove(id, TYPE_MACRO)
    this.microtask = this.nextTick
    this.macrotask = this.setImmediate
    this.setTimeout = (fn, delay) => this._add(delay, TYPE_TIMEOUT, { fn })
    this.setInterval = (fn, recur) => this._add(recur, TYPE_INTERVAL, { fn, recur, runs: 0 })
    this.clearTimeout = (id) => this._remove(id, TYPE_TIMEOUT)
    this.clearInterval = (id) => this._remove(id, TYPE_INTERVAL)
    this._runNextTurn_bnd = () => this._runNextTurn()
  }

  get scheduledCounts() {
    let n = this._numScheduled
    return {
      microtask: n.microtask,
      macrotask: n.macrotask,
      timeout: n.timeout,
      interval: n.interval
    }
  }

  onScheduled(fn) {
    this._newTaskObservers.push(fn)
  }

  removeScheduleObservers() {
    this._newTaskObservers.length = 0
  }

  whenDone(fn) {
    if (this._nextTurnScheduled || this._currentTurnDesc || this._numScheduled.microtask) {
      this._doneObservers.push(fn)
    } else {
      fn()
    }
  }

  _scheduleMicrotask(fn) {
    ++this._numScheduled.microtask
    nativeNextTick(() => this._runMicrotask(fn))
    this._callNewTaskObservers(fn, 'microtask', undefined)
  }

  _runMicrotask(fn) {
    let n = this._numScheduled
    --n.microtask
    tryRun(fn)
    if (!n.microtask && !this._schedule.length) {
      this._done()
    }
  }

  _getTickDesc(tick) {
    let turnDesc = this._scheduledTicks[tick]
    if (!turnDesc) {
      turnDesc = { tick, macrotasks: undefined, timers: undefined }
      let schedule = this._schedule
      let i = 0; for (; i < schedule.length; ++i) {
        let desc = schedule[i]
        if (desc.tick > tick) {
          break
        }
      }
      schedule.splice(i, 0, turnDesc)
      this._scheduledTicks[tick] = turnDesc
    }
    return turnDesc
  }

  _add(delay, type, task) {
    let id = task.id
    let isNew = id == null
    if (isNew) {
      task.type = type
      task.id = id = ++this._lastTaskId
      this._scheduledTaskIds[id] = task
    }

    let turnDesc = this._getTickDesc(this._currentTurn + Math.max(1, delay|0))
    let typeName

    switch (type) {
      case TYPE_MACRO:
        if (isNew) ++this._numScheduled.macrotask
        turnDesc.macrotasks = pushTo(turnDesc.macrotasks, task)
        typeName = 'macrotask'
        break
      case TYPE_TIMEOUT:
        if (isNew) ++this._numScheduled.timeout
        turnDesc.timers = pushTo(turnDesc.timers, task)
        typeName = 'timeout'
        break
      case TYPE_INTERVAL:
        typeName = 'interval'
        if (isNew) {
          ++this._numScheduled.interval
        } else if (++task.runs > this._maxIntervalRuns) {
          let err = new Error(`setInterval timer ran more than ${this._maxIntervalRuns} ` +
            `times: id ${ task.id }, delay ${ task.recur }, ${ task.fn }`)
          nativeNextTick(() => { throw err })
          break
        }
        turnDesc.timers = pushTo(turnDesc.timers, task)
        break
    }

    this._scheduleNextTurn()
    this._callNewTaskObservers(task.fn, typeName, id)

    return id
  }

  _callNewTaskObservers(fn, typeName, id) {
    let fns = this._newTaskObservers
    if (fns.length) {
      for (let i = 0; i < fns.length; ++i) {
        fns[i](fn, typeName, id)
      }
    }
  }

  _remove(id, type) {
    if (this._removedTaskIds[id]) {
      return
    }
    let task = this._scheduledTaskIds[id]
    if (task == null || task.type != type) {
      return
    }
    switch (task.type) {
      case TYPE_MACRO: --this._numScheduled.macrotask; break
      case TYPE_TIMEOUT: --this._numScheduled.timeout; break
      case TYPE_INTERVAL: --this._numScheduled.interval; break
    }
    this._removedTaskIds[id] = true
  }

  _scheduleNextTurn() {
    if (this._nextTurnScheduled) {
      return
    }
    if (this._schedule.length) {
      this._nextTurnScheduled = true
      nativeNextTurn(this._runNextTurn_bnd)
    } else if (!this._numScheduled.microtask) {
      this._done()
    }
  }

  _runNextTurn() {
    this._nextTurnScheduled = false

    let turnDesc = this._schedule.shift()
    this._currentTurnDesc = turnDesc
    this._currentTurn = turnDesc.tick
    delete this._scheduledTicks[this._currentTurn]

    this._runTasks(turnDesc.macrotasks)
    this._runTasks(turnDesc.timers)
    
    this._currentTurnDesc = undefined
    this._scheduleNextTurn()
  }

  _runTasks(tasks) {
    if (tasks == null) {
      return
    }
    let scheduledEntryIds = this._scheduledTaskIds
    let removedEntryIds = this._removedTaskIds
    for (let i = 0; i < tasks.length; ++i) {
      let entry = tasks[i]
      let {id} = entry
      if (removedEntryIds[id]) {
        delete removedEntryIds[id]
        delete scheduledEntryIds[id]
      } else {
        if (entry.type == TYPE_INTERVAL) {
          this._add(entry.recur, entry.type, entry)
        } else {
          switch (entry.type) {
            case TYPE_MACRO: --this._numScheduled.macrotask; break
            case TYPE_TIMEOUT: --this._numScheduled.timeout; break
          }
          delete scheduledEntryIds[id]
        }
        tryRun(entry.fn)
      }
    }
  }

  _done() {
    let afters = this._doneObservers
    if (!afters.length) {
      return
    }
    for (let i = 0; i < afters.length; ++i) {
      tryRun(afters[i])
    }
    this._doneObservers = []
  }
}

function tryRun(fn) {
  try {
    fn()
  } catch (err) {
    nativeNextTick(() => { throw err })
  }
}

function pushTo(arr, item) {
  if (arr) {
    arr.push(item)
    return arr
  } else {
    return [item]
  }
}
