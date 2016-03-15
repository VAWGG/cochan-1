import {Chan} from './chan'
import {SpecialChan, TimeoutChan, DelayChan, PromiseChan} from './special-chans'
import {EventEmitterMixin} from './event-emitter'
import {Thenable} from './thenable'
import {thenablePool} from './pools'
import {select, selectSync} from './select'
import {ChanWritableStreamMixin} from './writable-stream'
import {mergeTo} from './merge'
import {fromIterator, thenableRunner} from './iterator'
import {ISCHAN, CLOSED, OP_TAKE} from './constants'
import {mixin, describeArray, describeValue, defaultTo, extend, nop} from './utils'
import {isIterator, isGenerator, isGeneratorFunction} from './utils'
import schedule from './schedule'

module.exports = Chan
export default Chan
export {thenableRunner}


const iteratorSymbol = 'function' === typeof Symbol
  ? Symbol.iterator
  : undefined


const MERGE_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0
}

const FROM_ITERABLE_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0,
  sendRetval: false,
  async: false
}

const FROM_ITERATOR_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0,
  sendRetval: false,
  async: false
}

const FROM_GENERATOR_DEFAULTS = {
  output: undefined,
  closeOutput: true,
  bufferSize: 0,
  sendRetval: false,
  async: false
}

const ASYNC_DEFAULTS = {
  runner: thenableRunner,
  getRunnableType: thenableRunner.getRunnableType
}

const ASYNC_OFF = {
  runner: undefined,
  getRunnableType: undefined
}


class ChanBase {

  static isChan(obj) {
    return obj && obj._ischan === ISCHAN
  }

  static setScheduler({ microtask, macrotask }) {
    schedule.microtask = microtask || schedule.microtask
    schedule.macrotask = macrotask || schedule.macrotask
  }

  static timeout(ms, message) {
    return new TimeoutChan(ms, message)
  }

  static delay(ms, value) {
    return new DelayChan(ms, value)
  }

  static fromPromise(promise) {
    return new PromiseChan(promise)
  }

  static merge(/* ...chans */) {
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

  static fromIterable(iterable, opts) {
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

  static fromIterator(iter, opts) {
    if (!isIterator(iter)) {
      throw new TypeError(`iter must be an iterator; got: ${ iter }`)
    }
    return fromIteratorWithOpts(iter, opts, FROM_ITERATOR_DEFAULTS)
  }

  static fromGenerator(gen, opts) {
    if (!isIterator(gen)) {
      if (isGeneratorFunction(gen)) {
        gen = gen()
      } else {
        throw new TypeError(`gen must be a generator function or an iterator; got: ${ gen }`)
      }
    }
    return fromIteratorWithOpts(gen, opts, FROM_GENERATOR_DEFAULTS)
  }

  /**
   * Sets the object that replaces opts.async === true in
   * fromIterable, fromIterator and fromGenerator.
   */
  static setAsyncDefaults(opts) {
    extend(ASYNC_DEFAULTS, opts)
  }

  take() {
    let promise = thenablePool.take()
    let reuseId = promise._reuseId
    promise._chan = this
    promise._op = OP_TAKE
    schedule.microtask(() => {
      if (promise._reuseId == reuseId) {
        let bound = promise._bound
        let cancel = this._take(bound.fulfill, bound.reject, true)
        // the previous line might have already cancelled this promise
        // and put it into the reuse pool, so we need to check
        if (promise._reuseId == reuseId) {
          promise._cancel = cancel
        }
      }
    })
    return promise
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


ChanBase.CLOSED = CLOSED
ChanBase.prototype.CLOSED = CLOSED

ChanBase.select = select
ChanBase.selectSync = selectSync

ChanBase.merge.setDefaults = (opts) => { extend(MERGE_DEFAULTS, opts) }
ChanBase.fromIterable.setDefaults = (opts) => { extend(FROM_ITERABLE_DEFAULTS, opts) }
ChanBase.fromIterator.setDefaults = (opts) => { extend(FROM_ITERATOR_DEFAULTS, opts) }
ChanBase.fromGenerator.setDefaults = (opts) => { extend(FROM_GENERATOR_DEFAULTS, opts) }


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


const ChanBaseMixin = {
  $static: ChanBase,
  $proto: ChanBase.prototype
}


mixin(Chan, ChanBaseMixin)
mixin(Chan, ChanWritableStreamMixin)
mixin(Chan, EventEmitterMixin)

mixin(SpecialChan, ChanBaseMixin)
mixin(SpecialChan, EventEmitterMixin)
