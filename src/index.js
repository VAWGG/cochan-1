import assert from 'power-assert'
import {TimeoutChan, DelayChan} from './special-chans'
import {EventEmitterMixin} from './event-emitter'
import {Chan$BaseMixin} from './chan-mixin'
import {Chan$SelectMixin} from './select'
import {Chan$WritableStreamMixin} from './writable-stream'
import {mergeTo} from './merge'
import {mixin, repeat, nop} from './utils'
import {CLOSED, FAILED} from './constants'
import {P_RESOLVED, P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'


const STATE_NORMAL = 0
const STATE_WAITING_FOR_PUBLISHER = 1
const STATE_CLOSING = 2
const STATE_CLOSED = 3

const TYPE_VALUE = 0
const TYPE_ERROR = 1
const TYPE_WAITER = 2

const SUCCESS = []

const MERGE_DEFAULT_OPTS = {
  dst: undefined,
  closeDst: true,
  bufferSize: 0
}


class Chan {

  static timeout(ms, message) {
    return new TimeoutChan(ms, message)
  }

  static delay(ms, value) {
    return new DelayChan(ms, value)
  }

  static merge(/* ...chans */) {
    let chans = Array.apply(null, arguments)
    let opts = chans[ chans.length - 1 ]
    if (opts && opts.constructor === Object) {
      chans.pop()
    } else {
      opts = MERGE_DEFAULT_OPTS
    }
    let {dst} = opts; if (dst) {
      if (!Chan.isChan(dst)) {
        throw new TypeError('opts.dst must be a channel')
      }
    } else {
      dst = new Chan(opts.bufferSize)
    }
    return mergeTo(dst, chans, !!opts.closeDst)
  }

  constructor(bufferSize = 0) {
    this._initChanBase()
    this._initWritableStream()
    this._state = STATE_NORMAL
    this._bufferSize = bufferSize
    this._buffer = []
    this._totalWaiters = 0
    this._value = undefined
    this._nextPromise()
  }

  get value() {
    return this._value
  }

  get canSend() {
    return this._state < STATE_CLOSING
  }

  get canSendSync() {
    assert(this._buffer.length - this._totalWaiters >= 0)
    let numNonWaiters = this._buffer.length - this._totalWaiters
    // If waiting for publisher, there must be either at least one "real" consumer in the buffer, or
    // the channel must tolerate buffering (sending without blocking) at least one value.
    // If waiting for consumer, the channel must tolerate buffering at least one more value.
    return this._state == STATE_WAITING_FOR_PUBLISHER && (numNonWaiters > 0 || this._bufferSize > 0)
        || this._state == STATE_NORMAL && numNonWaiters < this._bufferSize
  }

  get canTakeSync() {
    assert(this._buffer.length - this._totalWaiters >= 0)
    return this._state != STATE_WAITING_FOR_PUBLISHER
        && this._buffer.length - this._totalWaiters > 0
  }

  get isClosingOrClosed() {
    return this._state >= STATE_CLOSING
  }

  get isClosed() {
    return this._state == STATE_CLOSED
  }

  sendErrorSync(err) {
    return this.sendSync(err, true)
  }

  sendError(err, close) {
    if (close) {
      return this.send(err, true).then(() => this.close())
    } else {
      return this.send(err, true)
    }
  }

  sendSync(val, isError) {
    if (this._state >= STATE_CLOSING) {
      throw new Error('attempt to send into a closed channel')
    }

    let waiters
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      waiters = this._sendToWaitingConsumer(val, isError)
      if (waiters === SUCCESS) { // value was consumed
        return true
      }
    }

    assert(this._state == STATE_NORMAL)
    assert(this._buffer.length - this._totalWaiters >= 0)

    if (this._buffer.length - this._totalWaiters < this._bufferSize) {
      this._buffer.push({ val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: undefined, fnErr: undefined })
      // notify all waiters for opportunity to consume
      waiters && this._triggerWaiters(waiters, val, isError)
      return true
    }

    if (waiters) {
      // on next tick, notify all waiters for opportunity to consume
      setImmediate(() => {
        let value = this._state == STATE_CLOSED ? CLOSED : undefined
        this._triggerWaiters(waiters, value, false)
      })
    }
    
    return false
  }

  send(val, isError) {
    return this._send(val, isError, this._resolve, this._reject) || this._nextPromise()
  }

  _send(val, isError, fnOk, fnErr) {
    if (this._state >= STATE_CLOSING) {
      return Promise.reject(new Error('attempt to send into a closed channel'))
    }

    let waiters
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      waiters = this._sendToWaitingConsumer(val, isError)
      if (waiters === SUCCESS) { // value was consumed
        return P_RESOLVED
      }
    }

    assert(this._state == STATE_NORMAL)
    assert(this._buffer.length - this._totalWaiters >= 0)

    if (this._buffer.length - this._totalWaiters < this._bufferSize) {
      this._buffer.push({ val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: undefined, fnErr: undefined })
      waiters && this._triggerWaiters(waiters, val, isError)
      return P_RESOLVED
    }

    this._buffer.push({ val, type: isError ? TYPE_ERROR : TYPE_VALUE, fnVal: fnOk, fnErr })
    waiters && this._triggerWaiters(waiters, val, isError)

    return undefined
  }

  takeSync() {
    if (this._state == STATE_CLOSED) {
      return false
    }

    if (this._state == STATE_WAITING_FOR_PUBLISHER || this._buffer.length == 0) {
      return false
    }

    assert(this._state == STATE_NORMAL || this._state == STATE_CLOSING)

    let result = this._takeFromWaitingPublisher()
    let {item} = result

    if (item === FAILED) {
      // on next tick, notify all waiters for opportunity to publish
      if (result.waiters) {
        setImmediate(() => {
          if (this._state < STATE_CLOSING) {
            this._triggerWaiters(result.waiters, undefined, false)
            this._needsDrain && this._emitDrain()
          } else {
            let err = new Error('channel closed')
            this._triggerWaiters(result.waiters, err, true)
          }
        })
      }
      return false
    }

    item.fnVal && item.fnVal()
    
    if (result.waiters) {
      setImmediate(() => {
        this._triggerWaiters(result.waiters, undefined, false)
        this._needsDrain && this._emitDrain()
      })
    }

    if (item.type == TYPE_ERROR) {
      throw item.val
    }

    assert(item.type == TYPE_VALUE)
    return true
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (this._state == STATE_CLOSED) {
      fnVal && fnVal(CLOSED)
      return nop
    }

    let waiters

    if (this._state != STATE_WAITING_FOR_PUBLISHER && this._buffer.length) {
      let result = this._takeFromWaitingPublisher()
      let {item} = result
      if (item !== FAILED) {
        item.fnVal && item.fnVal()
        assert(item.type == TYPE_VALUE || item.type == TYPE_ERROR)
        let fn = item.type == TYPE_VALUE ? fnVal : fnErr
        fn && fn(item.val)
        item.waiters && this._triggerWaiters(item.waiters)
        this._needsDrain && this._emitDrain()
        return nop
      }
      waiters = result.waiters
    }

    this._state = STATE_WAITING_FOR_PUBLISHER
    let item = { fnVal, fnErr, consumes: true }
    this._buffer.push(item)

    // notify all waiters for the opportunity to publish
    waiters && this._triggerWaiters(waiters, undefined, false)
    this._needsDrain && this._emitDrain()

    return needsCancelFn
      ? () => {
        item.fnVal = undefined
        item.fnErr = undefined
        item.consumes = false
      }
      : nop
  }

  maybeCanTakeSync() {
    if (this._state == STATE_CLOSED) {
      return P_RESOLVED_WITH_FALSE
    }
    if (this.canTakeSync) {
      return P_RESOLVED_WITH_TRUE
    }
    if (this._state == STATE_NORMAL && this._buffer.length) {
      // there are some waiters for opportunity to publish, but no data in the buffer
      assert(this._totalWaiters == this._buffer.length)
      assert.deepEqual(this._buffer.map(x => x.type), repeat(TYPE_WAITER, this._buffer.length))
      let waiters = this._buffer.slice()
      this._buffer.length = 0
      this._totalWaiters = 0
      this._triggerWaiters(waiters, undefined, false)
    } else if (this._state == STATE_CLOSING) {
      // closing but no data left in the buffer
      assert.ok(false, 'this should not happen')
      return P_RESOLVED_WITH_FALSE
    }
    assert(this._state == STATE_NORMAL || this._state == STATE_WAITING_FOR_PUBLISHER)
    this._state = STATE_WAITING_FOR_PUBLISHER
    return new Promise(resolve => {
      let onData = (data) => data === CLOSED ? resolve(false) : resolve(true)
      this._buffer.push({ fnVal: onData, fnErr: onData, consumes: false })
      ++this._totalWaiters
      this._needsDrain && this._emitDrain()
    })
  }

  maybeCanSendSync() {
    if (this._state >= STATE_CLOSING) {
      return P_RESOLVED_WITH_FALSE
    }
    if (this.canSendSync) {
      return P_RESOLVED_WITH_TRUE
    }
    if (this._state == STATE_WAITING_FOR_PUBLISHER && this._buffer.length) {
      // there are some waiters for opportunity to consume, but no actual consumers
      assert(this._totalWaiters == this._buffer.length)
      assert.deepEqual(this._buffer.map(x => x.consumes), repeat(false, this._buffer.length))
      let waiters = this._buffer.slice()
      this._buffer.length = 0
      this._totalWaiters = 0
      this._triggerWaiters(waiters, undefined, false)
    }
    assert(this._state == STATE_NORMAL || this._state == STATE_WAITING_FOR_PUBLISHER)
    return new Promise(resolve => {
      this._buffer.push({
        fnVal: () => resolve(true),
        fnErr: () => resolve(false),
        type: TYPE_WAITER
      })
      ++this._totalWaiters
    })
  }

  closeSync() {
    if (this._state == STATE_CLOSED) {
      return true
    }
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      this._state = STATE_CLOSED
      this._terminateAllWaitingConsumers()
      this.emit('finish')
      return true
    }
    if (this._buffer.length - this._totalWaiters == 0) {
      // there are no real publishers, only waiters for opportunity to publish => kill 'em
      assert.deepEqual(this._buffer.map(x => x.type), repeat(TYPE_WAITER, this._buffer.length))
      let prevState = this._state
      this._state = STATE_CLOSED
      this._terminateAllWaitingPublishers()
      if (prevState != STATE_CLOSING) {
        this.emit('finish')
      }
      return true
    }
    assert(this._buffer.length - this._totalWaiters > 0)
    return false
  }

  close() {
    if (this.closeSync()) {
      assert(this._state == STATE_CLOSED)
      return P_RESOLVED
    }

    if (this._state == STATE_CLOSING) {
      assert(this._buffer.length > 0)
      assert(this._buffer[ this._buffer.length - 1 ].promise != undefined)
      return this._buffer[ this._buffer.length - 1 ].promise
    }

    let resolve, promise = new Promise(res => { resolve = res })
    let item = { promise, fns: [resolve], fnVal: undefined, fnErr: undefined }

    item.fnVal = item.fnErr = () => {
      this.emit('finish')
      callFns(item.fns)
    }

    this._buffer.push(item)
    this._state = STATE_CLOSING
    ++this._totalWaiters

    return promise
  }

  closeNow() {
    if (!this.closeSync()) {
      let prevState = this._state
      this._state = STATE_CLOSED
      this._terminateAllWaitingPublishers()
      if (prevState != STATE_CLOSING) {
        this.emit('finish')
      }
    }
  }

  _takeFromWaitingPublisher() {
    assert(this._state == STATE_NORMAL || this._state == STATE_CLOSING)
    assert(this._buffer.length > 0)

    let item = this._buffer.shift()
    let waiters

    while (item && item.type == TYPE_WAITER) {
      if (!waiters) {
        waiters = [item]
      } else {
        waiters.push(item)
      }
      --this._totalWaiters
      item = this._buffer.shift()
    }

    assert(this._totalWaiters >= 0)

    if (!item) {
      // no value was produced, so return a list of waiters that should be notified
      // that there is a waiting consumer after the latter is pushed on the list
      assert(this._buffer.length == 0)
      this._state = STATE_WAITING_FOR_PUBLISHER
      return { item: FAILED, waiters: waiters }
    }

    assert(item.type == TYPE_VALUE || item.type == TYPE_ERROR)

    if (item.type == TYPE_VALUE) {
      this._value = item.val
    }

    if (this._state == STATE_CLOSING && this._buffer.length == 1) {
      // the only item left is the one containing closing listeners
      assert(this._buffer[0].promise != undefined)
      assert(this._buffer[0].fnVal != undefined)
      this._state = STATE_CLOSED
      // the channel has closed, so notify all waiters for opportunity to publish
      waiters && this._triggerWaiters(waiters, CLOSED, false)
      // notify that the channel has closed
      this._totalWaiters = 0
      this._buffer.shift().fnVal()
    } else if (waiters) {
      // the value will be produced, so put all waiters for opportunity to publish
      // back where they were before
      this._prependWaiters(waiters)
    }

    return { item, waiters: undefined }
  }

  _sendToWaitingConsumer(val, isError) {
    assert(this._state == STATE_WAITING_FOR_PUBLISHER)
    assert(this._buffer.length > 0)

    // skip all cancelled consumers, and collect all waiters
    let item = this._buffer.shift()
    let waiters

    while (item && !item.consumes) {
      if (item.fnVal || item.fnErr) { // item is waiter; otherwise, item is a cancelled consumer
        if (!waiters) {
          waiters = [item]
        } else {
          waiters.push(item)
        }
        --this._totalWaiters
      }
      item = this._buffer.shift()
    }

    assert(this._totalWaiters >= 0)

    if (!item) {
      // the value wasn't consumed, so return a list of waiters that should be notified
      // after the value have been pushed onto the buffer
      assert(this._buffer.length == 0)
      this._state = STATE_NORMAL
      return waiters
    }

    // the value will be consumed, so put all waiters for opportunity to consume back
    // where they were before
    if (waiters) {
      this._prependWaiters(waiters)
    }

    if (this._buffer.length == 0) {
      assert(this._totalWaiters == 0)
      this._state = STATE_NORMAL
    }

    if (isError) {
      item.fnErr && item.fnErr(val)
    } else {
      this._value = val
      item.fnVal && item.fnVal(val)
    }

    return SUCCESS
  }

  _triggerWaiters(waiters, val, isError) {
    if (isError) {
      for (let i = 0; i < waiters.length; ++i) {
        let waiter = waiters[i]
        waiter.fnErr && waiter.fnErr(val)
      }
    } else {
      for (let i = 0; i < waiters.length; ++i) {
        let waiter = waiters[i]
        waiter.fnVal && waiter.fnVal(val)
      }
    }
  }

  _prependWaiters(waiters) {
    for (let i = waiters.length - 1; i >= 0; --i) {
      this._buffer.unshift(waiters[i])
    }
    this._totalWaiters += waiters.length
    assert(this._totalWaiters <= this._buffer.length)
  }

  _terminateAllWaitingConsumers() {
    assert(this._buffer.findIndex(x => x.consumes === undefined) == -1, 'no publishers')
    this._totalWaiters = 0
    while (this._buffer.length) {
      let item = this._buffer.shift()
      item.fnVal && item.fnVal(CLOSED)
    }
  }

  _terminateAllWaitingPublishers() {
    assert(this._buffer.findIndex(x => x.consumes !== undefined) == -1, 'no consumers')
    let triggerError = this._buffer.length - this._totalWaiters > 0
    this._totalWaiters = 0
    let err = new Error('channel closed')
    while (this._buffer.length) {
      let item = this._buffer.shift()
      item.fnErr && item.fnErr(err)
    }
    if (triggerError) {
      this.trigger('error', err)
    }
  }

  _nextPromise() {
    let promise = this._promise
    this._promise = new Promise((res, rej) => { this._resolve = res; this._reject = rej })
    return promise
  }

  get _constructorName() {
    return 'chan'
  }

  get _constructorArgsDesc() {
    return [ this._bufferSize ]
  }
}


function callFns(fns) {
  for (let i = 0; i < fns.length; ++i) {
    fns[i]()
  }
}


mixin(Chan, EventEmitterMixin)
mixin(Chan, Chan$BaseMixin)
mixin(Chan, Chan$SelectMixin)
mixin(Chan, Chan$WritableStreamMixin)


module.exports = Chan
export default Chan
