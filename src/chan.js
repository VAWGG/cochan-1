import assert from 'power-assert'
import schedule from './schedule'
import {Thenable} from './thenable'
import {thenablePool} from './pools'
import {repeat, nop} from './utils'
import {CLOSED, FAILED, OP_SEND} from './constants'
import {P_RESOLVED, P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'


const STATE_NORMAL = 0
const STATE_WAITING_FOR_PUBLISHER = 1
const STATE_CLOSING = 2
const STATE_CLOSED = 3

const TYPE_VALUE = 0
const TYPE_ERROR = 1
const TYPE_WAITER = 2
const TYPE_CANCELLED = 3

const SUCCESS = []


export class Chan {

  constructor(bufferSize = 0) {
    this._initWritableStream()
    this._state = STATE_NORMAL
    this._bufferSize = bufferSize
    this._buffer = []
    this._totalWaiters = 0
    this._value = undefined
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
    // console.log(`    ${this}.sendSync(${val}, ${!!isError})`)

    if (this._state >= STATE_CLOSING) {
      return false
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
      schedule.microtask(() => {
        let value = this._state == STATE_CLOSED ? CLOSED : undefined
        this._triggerWaiters(waiters, value, false)
      })
    }
    
    return false
  }

  send(value, isError) {
    let promise = thenablePool.take()
    let reuseId = promise._reuseId
    promise._chan = this
    promise._op = OP_SEND
    promise._sendData = { value, isError }
    schedule.microtask(() => {
      if (promise._reuseId == reuseId) {
        let bound = promise._bound
        let cancel = this._send(value, isError, bound.fulfill, bound.reject, true)
        // the previous line might have already cancelled this promise
        // and put it into the reuse pool, so we need to check
        if (promise._reuseId == reuseId) {
          promise._cancel = cancel
        }
      }
    })
    return promise
  }

  _send(val, isError, fnOk, fnErr, needsCancelFn) {
    // console.log(`    ${this}._send(${val}, ${!!isError})`)

    if (this._state >= STATE_CLOSING) {
      fnErr(new Error('attempt to send into a closed channel'))
      return nop
    }

    let waiters
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      waiters = this._sendToWaitingConsumer(val, isError)
      if (waiters === SUCCESS) { // value was consumed
        fnOk(undefined)
        return nop
      }
    }

    assert(this._state == STATE_NORMAL)
    assert(this._buffer.length - this._totalWaiters >= 0)

    let item

    if (this._buffer.length - this._totalWaiters < this._bufferSize) {
      this._buffer.push(item = { val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: undefined, fnErr: undefined })
      fnOk(undefined)
    } else {
      this._buffer.push(item = { val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: fnOk, fnErr: fnErr })
    }

    waiters && this._triggerWaiters(waiters, val, isError)
    return needsCancelFn ? () => { item.type = TYPE_CANCELLED } : nop
  }

  takeSync() {
    // console.log(`    ${this}.takeSync()`)

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
        schedule.microtask(() => {
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

    let type = item.type
    assert(type == TYPE_VALUE || type == TYPE_ERROR)

    item.fnVal && item.fnVal()
    
    if (result.waiters) {
      schedule.microtask(() => {
        this._triggerWaiters(result.waiters, undefined, false)
        this._needsDrain && this._emitDrain()
      })
    }

    if (type == TYPE_ERROR) {
      throw item.val
    }

    assert(type == TYPE_VALUE)
    return true
  }

  _take(fnVal, fnErr, needsCancelFn) {
    // console.log(`    ${this}._take()`)

    if (this._state == STATE_CLOSED) {
      fnVal && fnVal(CLOSED)
      return nop
    }

    let waiters

    if (this._state != STATE_WAITING_FOR_PUBLISHER && this._buffer.length) {
      let result = this._takeFromWaitingPublisher()
      let {item} = result
      if (item !== FAILED) {
        assert(item.type == TYPE_VALUE || item.type == TYPE_ERROR)
        let fn = item.type == TYPE_VALUE ? fnVal : fnErr
        item.fnVal && item.fnVal() // this may change item.type to TYPE_CANCELLED
        fn && fn(item.val)
        result.waiters && this._triggerWaiters(result.waiters)
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

    while (item && item.type > TYPE_ERROR) {
      if (item.type == TYPE_WAITER) {
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
