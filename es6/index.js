import BaseChan from './base-chan'
import {CLOSED, FAILED, nop} from './constants'
import {P_RESOLVED, P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'
import {TimeoutChan, DelayChan} from './special-chans'
import {selectSync, select} from './select'
import applyStream from './apply-stream'


const STATE_NORMAL = 0
const STATE_WAITING_FOR_PUBLISHER = 1
const STATE_CLOSING = 2
const STATE_CLOSED = 3

const TYPE_VALUE = 0
const TYPE_ERROR = 1
const TYPE_WAITER = 2

const SUCCESS = []


class Chan extends BaseChan
{
  static isChan(obj) {
    return obj instanceof BaseChan
  }

  static timeout(ms, message) {
    return new TimeoutChan(ms, message)
  }

  static delay(ms, value) {
    return new DelayChan(ms, value)
  }

  static fromStream(emitter, bufferSize = 0) {
    let chan = new Chan(bufferSize)
    applyStream(emitter, chan, true, true)
    return chan
  }

  constructor(bufferSize = 0) {
    super()
    this._state = STATE_NORMAL
    this._bufferSize = bufferSize
    this._buffer = []
    this._totalWaiters = 0
    this._value = undefined
  }

  get value() {
    return this._value
  }

  get canPut() {
    return this._state < STATE_CLOSING
  }

  get canPutSync() {
    let numNonWaiters = this._buffer.length - this._totalWaiters
    return this._state == STATE_WAITING_FOR_PUBLISHER && numNonWaiters > 0
        || this._state == STATE_NORMAL && numNonWaiters < this._bufferSize
  }

  get canTakeSync() {
    return this._state != STATE_WAITING_FOR_PUBLISHER
        && this._buffer.length - this._totalWaiters > 0
  }

  get isClosingOrClosed() {
    return this._state >= STATE_CLOSING
  }

  get isClosed() {
    return this._state == STATE_CLOSED
  }

  putErrorSync(err) {
    return this.putSync(err, true)
  }

  putError(err, close) {
    if (close) {
      return this.put(err, true).then(() => this.close())
    } else {
      return this.put(err, true)
    }
  }

  putSync(val, isError) {
    if (this._state >= STATE_CLOSING) {
      throw new Error('attempt to put into a closed channel')
    }

    let waiters
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      waiters = this._sendToWaitingConsumer(val, isError)
      if (waiters === SUCCESS) { // value was consumed
        return true
      }
    }
    // the only possible state now is STATE_NORMAL

    if (this._buffer.length - this._totalWaiters < this._bufferSize) {
      this._buffer.push({ val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: undefined, fnErr: undefined })
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

  put(val, isError) {
    if (this._state >= STATE_CLOSING) {
      return Promise.reject(new Error('attempt to put into a closed channel'))
    }

    let waiters
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      waiters = this._sendToWaitingConsumer(val, isError)
      if (waiters === SUCCESS) { // value was consumed
        return P_RESOLVED
      }
    }
    // the only possible state now is STATE_NORMAL

    if (this._buffer.length - this._totalWaiters < this._bufferSize) {
      this._buffer.push({ val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: undefined, fnErr: undefined })
      waiters && this._triggerWaiters(waiters, val, isError)
      return P_RESOLVED
    }

    return new Promise((res, rej) => {
      this._buffer.push({ val, type: isError ? TYPE_ERROR : TYPE_VALUE,
        fnVal: res, fnErr: rej })
      waiters && this._triggerWaiters(waiters, val, isError)
    })
  }

  takeSync() {
    if (this._state == STATE_CLOSED) {
      return false
    }

    if (this._state == STATE_WAITING_FOR_PUBLISHER || this._buffer.length == 0) {
      return false
    }
    // now state is either STATE_NORMAL or STATE_CLOSING

    let result = this._takeFromWaitingPublisher()
    if (result.item === FAILED) {
      // on next tick, notify all waiters for opportunity to publish
      if (result.waiters) {
        setImmediate(() => {
          if (this._state < STATE_CLOSING) {
            this._triggerWaiters(result.waiters, undefined, false)
          } else {
            let err = new Error('channel closed')
            this._triggerWaiters(result.waiters, err, true)
          }
        })
      }
      return false
    }

    let {item} = result
    item.fnVal && item.fnVal()
    
    if (result.waiters) {
      setImmediate(() => this._triggerWaiters(result.waiters, undefined, false))
    }

    if (item.type == TYPE_ERROR) {
      throw item.val
    }

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
        let fn = item.type == TYPE_VALUE ? fnVal : fnErr
        fn && fn(item.val)
        item.waiters && this._triggerWaiters(item.waiters)
        return nop
      }
      waiters = result.waiters
    }

    this._state = STATE_WAITING_FOR_PUBLISHER
    let item = { fnVal, fnErr, consumes: true }
    this._buffer.push(item)

    // notify all waiters for the opportunity to publish
    waiters && this._triggerWaiters(waiters, undefined, false)

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
      let waiters = this._buffer.slice()
      this._buffer.length = 0
      this._totalWaiters = 0
      this._triggerWaiters(waiters, undefined, false)
      return new Promise(res => setImmediate(() => res(this._state != STATE_CLOSED)))
    }
    if (this._state == STATE_CLOSING) {
      // closing but no data left in the buffer
      return P_RESOLVED_WITH_FALSE
    }
    this._state = STATE_WAITING_FOR_PUBLISHER
    return new Promise(resolve => {
      let onData = (data) => data === CLOSED ? resolve(false) : resolve(true)
      this._buffer.push({ fnVal: onData, fnErr: onData, consumes: false })
      ++this._totalWaiters
    })
  }

  maybeCanPutSync() {
    if (this._state >= STATE_CLOSING) {
      return P_RESOLVED_WITH_FALSE
    }
    if (this.canPutSync) {
      return P_RESOLVED_WITH_TRUE
    }
    if (this._state == STATE_WAITING_FOR_PUBLISHER && this._buffer.length) {
      // there are some waiters for opportunity to consume, but no actual consumers
      let waiters = this._buffer.slice()
      this._buffer.length = 0
      this._totalWaiters = 0
      this._triggerWaiters(waiters, undefined, false)
      return new Promise(res => setImmediate(() => res(this._state < STATE_CLOSING)))
    }
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
      return true
    }
    if (this._buffer.length - this._totalWaiters == 0) {
      this._state = STATE_CLOSED
      this._terminateAllWaitingPublishers()
      return true
    }
    return false
  }

  close() {
    if (this.closeSync()) {
      return P_RESOLVED
    }

    let resolve
    let promise = new Promise(res => { resolve = res })

    if (this._state == STATE_CLOSING) {
      this._buffer[ this._buffer.length - 1 ].fns.push(resolve)
      return promise
    }

    let item = { fns: [resolve], fnVal: undefined, fnErr: undefined }
    item.fnVal = item.fnErr = () => callFns(item.fns)

    this._buffer.push(item)
    this._state = STATE_CLOSING
    ++this._totalWaiters

    return promise
  }

  closeNow() {
    if (!this.closeSync()) {
      this._state = STATE_CLOSED
      this._terminateAllWaitingPublishers()
    }
  }

  _takeFromWaitingPublisher() {
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

    if (!item) {
      // no value was produced, so return a list of waiters that should be notified
      // that there is a waiting consumer after the latter is pushed on the list
      this._state = STATE_WAITING_FOR_PUBLISHER
      return { item: FAILED, waiters: waiters }
    }

    if (item.type == TYPE_VALUE) {
      this._value = item.val
    }

    if (this._state == STATE_CLOSING && this._buffer.length == 1) {
      // the only item left is the one containing closing listeners
      this._state = STATE_CLOSED
      // the channel has closed, so notify all waiters for opportunity to publish
      waiters && this._triggerWaiters(waiters, CLOSED, false)
      // notify that the channel has closed
      this._buffer.shift().fnVal()
    } else if (waiters) {
      // the value will be produced, so put all waiters for opportunity to publish
      // back where they were before
      this._prependWaiters(waiters)
    }

    return { item, waiters: undefined }
  }

  _sendToWaitingConsumer(val, isError) {
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

    if (!item) {
      // the value wasn't consumed, so return a list of waiters that should be notified
      // after the value have been pushed onto the buffer
      this._state = STATE_NORMAL
      return waiters
    }

    // the value will be consumed, so put all waiters for opportunity to consume back
    // where they were before
    if (waiters) {
      this._prependWaiters(waiters)
    }

    if (this._buffer.length == 0) {
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
  }

  _terminateAllWaitingConsumers() {
    this._totalWaiters = 0
    while (this._buffer.length) {
      let item = this._buffer.shift()
      item.fnVal && item.fnVal(CLOSED)
    }
  }

  _terminateAllWaitingPublishers() {
    this._totalWaiters = 0
    let err = new Error('channel closed')
    while (this._buffer.length) {
      let item = this._buffer.shift()
      item.fnErr && item.fnErr(err)
    }
  }

  toString() {
    return this.name === undefined
      ? `Chan(${ this._bufferSize })`
      : `Chan<${ this.name }>(${ this._bufferSize })`
  }
}


function callFns(fns) {
  for (let i = 0; i < fns.length; ++i) {
    fns[i]()
  }
}


Chan.CLOSED = CLOSED
Chan.FAILED = FAILED

Chan.selectSync = selectSync
Chan.select = select


BaseChan.prototype.CLOSED = CLOSED
BaseChan.prototype.FAILED = FAILED

BaseChan.prototype.delay = Chan.delay
BaseChan.prototype.timeout = Chan.timeout


Chan.prototype.CLOSED = CLOSED
Chan.prototype.FAILED = FAILED

Chan.prototype.delay = Chan.delay
Chan.prototype.timeout = Chan.timeout


module.exports = Chan
export default Chan
