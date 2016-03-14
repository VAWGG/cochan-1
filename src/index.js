import {Chan} from './chan'
import {SpecialChan, TimeoutChan, DelayChan, PromiseChan} from './special-chans'
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

module.exports = Chan
export default Chan
export {thenableRunner}


const iteratorSymbol = 'function' === typeof Symbol
  ? Symbol.iterator
  : undefined


const MERGE_DEFAULTS = {
  dst: undefined, // TODO: rename to "output"
  closeDst: true, // TODO: rename to "closeOutput"
  bufferSize: 0
}

const FROM_ITERABLE_DEFAULTS = {
  chan: undefined, // TODO: rename to "output"
  closeChan: true, // TODO: rename to "closeOutput"
  bufferSize: 0,
  sendRetval: false,
  async: false,
  asyncRunner: thenableRunner,
  getAsyncRunnableType: thenableRunner.getRunnableType
}

const FROM_ITERATOR_DEFAULTS = {
  chan: undefined, // TODO: rename to "output"
  closeChan: true, // TODO: rename to "closeOutput"
  bufferSize: 0,
  sendRetval: false,
  async: false,
  asyncRunner: thenableRunner,
  getAsyncRunnableType: thenableRunner.getRunnableType
}

const FROM_GENERATOR_DEFAULTS = {
  chan: undefined, // TODO: rename to "output"
  closeChan: true, // TODO: rename to "closeOutput"
  bufferSize: 0,
  sendRetval: false,
  async: false,
  asyncRunner: thenableRunner,
  getAsyncRunnableType: thenableRunner.getRunnableType
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
      createChanIfUndefined(opts.dst, opts.bufferSize, MERGE_DEFAULTS.bufferSize, 'opts.dst'),
      chans,
      opts.closeDst === undefined ? MERGE_DEFAULTS.closeDst : !!opts.closeDst
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

  take() {
    let promise = new Thenable(this, OP_TAKE)
    promise._cancel = this._take(promise._fulfillBound, promise._rejectBound, true)
    return promise
  }

  toString() {
    let desc = this.name == undefined
      ? `${ this._constructorName }(${ describeArray(this._constructorArgsDesc) })`
      : `${ this._constructorName }<${ this.name }>(${ describeArray(this._constructorArgsDesc) })`
    return this.isClosingOrClosed
      ? (this.isClosed ? '[x]' : '[.]') + desc
      : desc
  }

  inspect() {
    return this.toString()
  }

  get _constructorName() {
    return this.constructor.name
  }

  get _constructorArgsDesc() {
    return []
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
  let asyncRunner, getAsyncRunnableType
  if (defaultTo(defaults.async, opts.async)) {
    asyncRunner = defaultTo(defaults.asyncRunner, opts.asyncRunner),
    getAsyncRunnableType = defaultTo(defaults.getAsyncRunnableType, opts.getAsyncRunnableType)
  }
  return fromIterator(iter,
    createChanIfUndefined(opts.chan, opts.bufferSize, defaults.bufferSize, 'opts.chan'),
    defaultTo(defaults.closeChan, opts.closeChan),
    defaultTo(defaults.sendRetval, opts.sendRetval),
    asyncRunner, getAsyncRunnableType
  )
}

function createChanIfUndefined(chan, bufferSize, defaultBufferSize, argName) {
  if (chan != undefined) {
    if (!Chan.isChan(chan)) throw new TypeError(
      `${ argName } must be either undefined or a channel; got: ${ describeValue(chan) }`)
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
