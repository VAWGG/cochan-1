import {Chan} from './chan'
import {SpecialChan, SignalChan, TimeoutChan, DelayChan, PromiseChan} from './special-chans'
import {TakeOnlyChanProxy, SendOnlyChanProxy} from './unidirectional'
import {EventEmitterMixin} from './event-emitter'
import {Thenable} from './thenable'
import {select, selectSync} from './select'
import {ChanWritableStreamMixin} from './writable-stream'
import {mergeTo} from './merge'
import {fromIterator, thenableRunner} from './iterator'
import {ISCHAN, CLOSED, OP_TAKE} from './constants'
import {mixin, describeArray, describeValue, defaultTo, extend, nop} from './utils'
import {isIterator, isGenerator, isGeneratorFunction} from './utils'
import schedule from './schedule'


module.exports = chan; export default function chan(bufferSize = 0) {
  return new Chan(bufferSize)
}

export {Chan}
export {SpecialChan, SignalChan, TimeoutChan, DelayChan, PromiseChan}
export {CLOSED, thenableRunner}


chan.CLOSED = CLOSED


chan.select = select
chan.selectSync = selectSync

/**
 * Determines whether the passed value is a channel object.
 */
chan.isChan = function isChan(obj) {
  return obj && obj._ischan === ISCHAN
}

/**
 * Creates a signal channel, which is a special channel that yields nothing until it
 * is triggered, and, after it gets triggered with some value, yields this value to
 * all current and future consumers.
 *
 * Useful for communicating the same message to an arbitrary number of consumers.
 *
 * This channel never closes, and doesn't support sending values manually. Any attempt
 * to send a value or close the channel will result in an error thrown.
 */
chan.signal = function signal(value) {
  return new SignalChan(value)
}

/**
 * Creates a timeout channel, which is a special channel that yields nothing until it
 * is triggered, and, after it gets triggered with some message, yields an error with
 * the specified message to all current and future consumers.
 *
 * Can be used inside `select` statement to enforce timeout on a set of operations.
 *
 * This channel never closes, and doesn't support sending values manually. Any attempt
 * to send a value or close the channel will result in an error thrown.
 */
chan.timeout = function timeout(ms, message) {
  return new TimeoutChan(ms, message)
}

/**
 * Creates a channel that yields nothing until the specified number of milliseconds
 * is passed, and, after that, produces exactly one value and then immediately closes.
 *
 * The value to produce may be specified in the optional second parameter, and defaults
 * to undefined.
 *
 * This channel doesn't support sending values manually. Any attempt to do so will
 * result in an error thrown.
 */
chan.delay = function delay(ms, value) {
  return new DelayChan(ms, value)
}

/**
 * Creates a channel that yields nothing until the specified Promise is settled, and,
 * after that, produces exactly one value or error and then closes.
 *
 * This channel doesn't support sending values manually. Any attempt to do so will
 * result in an error thrown.
 */
chan.fromPromise = function fromPromise(promise) {
  return new PromiseChan(promise)
}


const MERGE_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0
}

chan.merge = function merge(/* ...chans */) {
  let chans = Array.apply(null, arguments)
  let opts = chans[ chans.length - 1 ]
  if (opts && opts.constructor === Object) {
    chans.pop()
  } else {
    opts = MERGE_DEFAULTS
  }
  return mergeTo(
    createChanIfUndefined(opts.output, opts.bufferSize, MERGE_DEFAULTS.bufferSize),
    chans,
    opts.closeOutput === undefined ? MERGE_DEFAULTS.closeOutput : !!opts.closeOutput
  )
}

chan.merge.setDefaults = function merge$setDefaults(opts) {
  extend(MERGE_DEFAULTS, opts)
}


const FROM_ITERABLE_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0,
  sendRetval: false,
  async: false
}

const ASYNC_DEFAULTS = { // applied when opts.async === true
  runner: thenableRunner,
  getRunnableType: thenableRunner.getRunnableType
}

const ASYNC_OFF = { // applied when Boolean(opts.async) == false
  runner: undefined,
  getRunnableType: undefined
}

const iteratorSymbol = 'function' === typeof Symbol
  ? Symbol.iterator
  : undefined

chan.fromIterable = function fromIterable(iterable, opts) {
  if (!iteratorSymbol) {
    throw new TypeError('global.Symbol.iterator is required to use chan.fromIterable()')
  }
  if (!iterable || 'function' !== typeof iterable[ iteratorSymbol ]) {
    throw new TypeError(`iterable must be an Iterable; got: ${ gen }`)
  }
  let iter = iterable[ iteratorSymbol ]()
  if (!isIterator(iter)) {
    throw new TypeError(`iter must be an iterator; got: ${ iter }`)
  }
  return fromIteratorWithOpts(iter, opts, FROM_ITERABLE_DEFAULTS)
}

chan.fromIterable.setDefaults = function fromIterable$setDefaults(opts) {
  extend(FROM_ITERABLE_DEFAULTS, opts)
}


const FROM_ITERATOR_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0,
  sendRetval: false,
  async: false
}

chan.fromIterator = function fromIterator(iter, opts) {
  if (!isIterator(iter)) {
    throw new TypeError(`iter must be an iterator; got: ${ iter }`)
  }
  return fromIteratorWithOpts(iter, opts, FROM_ITERATOR_DEFAULTS)
}

chan.fromIterator.setDefaults = function fromIterator$setDefaults(opts) {
  extend(FROM_ITERATOR_DEFAULTS, opts)
}


const FROM_GENERATOR_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0,
  sendRetval: false,
  async: false
}

chan.fromGenerator = function fromGenerator(gen, opts) {
  if (!isIterator(gen)) {
    if (isGeneratorFunction(gen)) {
      gen = gen()
    } else {
      throw new TypeError(`gen must be a generator function or an iterator; got: ${ gen }`)
    }
  }
  return fromIteratorWithOpts(gen, opts, FROM_GENERATOR_DEFAULTS)
}

chan.fromGenerator.setDefaults = function fromGenerator$setDefaults(opts) {
  extend(FROM_GENERATOR_DEFAULTS, opts)
}


/**
 * Sets the object that replaces opts.async === true in
 * fromIterable, fromIterator and fromGenerator.
 */
chan.setAsyncDefaults = function setAsyncDefaults(opts) {
  extend(ASYNC_DEFAULTS, opts)
}

/**
 * Sets functions for scheduling micro- and macrotasks.
 */
chan.setScheduler = function setScheduler({ microtask, macrotask }) {
  schedule.microtask = microtask || schedule.microtask
  schedule.macrotask = macrotask || schedule.macrotask
}


class ChanBaseMixin {

  get canTake() {
    return true
  }

  take() {
    let promise = new Thenable(this, OP_TAKE)
    schedule.microtask(() => {
      if (promise._op) {
        let bound = promise._bound
        let cancel = this._take(bound.fulfill, bound.reject, true)
        // the previous line might have already cancelled this promise, so we need to check
        if (promise._op) {
          promise._cancel = cancel
        }
      }
    })
    return promise
  }

  get takeOnly() {
    if (this._takeOnly) {
      return this._takeOnly
    }
    return this._takeOnly = new TakeOnlyChanProxy(this)
  }

  get sendOnly() {
    if (this._sendOnly) {
      return this._sendOnly
    }
    return this._sendOnly = new SendOnlyChanProxy(this)
  }

  named(name) {
    this.name = name
    return this
  }

  toString() {
    let flags = this._displayFlags
    let desc = this.name == undefined
      ? `${ this._constructorName }(${ describeArray(this._constructorArgsDesc) })`
      : `${ this._constructorName }<${ this.name }>(${ describeArray(this._constructorArgsDesc) })`
    return flags
      ? `[${ flags }]${ desc }`
      : desc
  }

  inspect() {
    return this.toString()
  }

  get _constructorName() {
    return this.constructor.name
  }

  get _constructorArgsDesc() {
    return undefined
  }

  get _displayFlags() {
    return this.isActive ? '' : (this.isClosed ? 'x' : '.')
  }

  get _ischan() {
    return ISCHAN
  }
}


ChanBaseMixin.prototype.CLOSED = CLOSED
ChanBaseMixin.prototype._takeOnly = undefined
ChanBaseMixin.prototype._sendOnly = undefined


function fromIteratorWithOpts(iter, opts, defaults) {
  opts = opts || defaults
  let async = defaultTo(defaults.async, opts.async)
  return fromIterator(iter,
    createChanIfUndefined(opts.output, opts.bufferSize, defaults.bufferSize),
    defaultTo(defaults.closeOutput, opts.closeOutput),
    defaultTo(defaults.sendRetval, opts.sendRetval),
    async ? async === true ? ASYNC_DEFAULTS : {
      runner: defaultTo(ASYNC_DEFAULTS.runner, async.runner),
      getRunnableType: defaultTo(ASYNC_DEFAULTS.getRunnableType, async.getRunnableType)
    } : ASYNC_OFF
  )
}

function createChanIfUndefined(chan, bufferSize, defaultBufferSize) {
  if (chan != undefined) {
    if (!Chan.isChan(chan)) throw new TypeError(
      `opts.output must be either undefined or a channel; got: ${ describeValue(chan) }`)
    return chan
  }
  return new Chan(bufferSize === undefined ? defaultBufferSize : bufferSize)
}


mixin(Chan, ChanBaseMixin.prototype)
mixin(Chan, ChanWritableStreamMixin)
mixin(Chan, EventEmitterMixin)

mixin(SpecialChan, ChanBaseMixin.prototype)
mixin(SpecialChan, EventEmitterMixin)

mixin(TakeOnlyChanProxy, ChanBaseMixin.prototype)
mixin(TakeOnlyChanProxy, EventEmitterMixin)

mixin(SendOnlyChanProxy, ChanBaseMixin.prototype)
mixin(SendOnlyChanProxy, EventEmitterMixin)
