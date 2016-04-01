import assert from 'power-assert'
import schedule from './schedule'
import {Thenable} from './thenable'
import {nop} from './utils'
import {CLOSED, FAILED, OP_SEND, ERROR} from './constants'
import {SEND_TYPE_VALUE, SEND_TYPE_ERROR, SEND_TYPE_INTENT} from './constants'
import {P_RESOLVED, P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'


const STATE_NORMAL = 0
const STATE_WAITING_FOR_PUBLISHER = 1
const STATE_CLOSING = 2
const STATE_CLOSED = 3


export class Chan {

  constructor(bufferSize) {
    this._initWritableStream()
    this._state = STATE_NORMAL
    this._bufferSize = bufferSize
    this._buffer = []
    this._waiters = []
    this._value = undefined
  }

  get value() {
    return this._value
  }

  get isActive() {
    return this._state < STATE_CLOSING
  }

  get isClosed() {
    return this._state == STATE_CLOSED
  }

  get canSend() {
    // the same as isActive
    return this._state < STATE_CLOSING
  }

  get canSendSync() {
    // If waiting for publisher, there must be either at least one waiting real consumer, or
    // the channel must tolerate buffering at least one value.
    // If waiting for consumer, the channel must tolerate buffering at least one more value.
    return this._state == STATE_WAITING_FOR_PUBLISHER
        && (this._buffer.length > 0 || this._bufferSize > 0)
      || this._state == STATE_NORMAL && this._buffer.length < this._bufferSize
  }

  get canTakeSync() {
    return this._state != STATE_WAITING_FOR_PUBLISHER && this._buffer.length > 0
  }

  _sendSync(value, type) {
    if (this._state >= STATE_CLOSING) {
      return false
    }

    let wasWaitingForPublisher = this._state == STATE_WAITING_FOR_PUBLISHER
    if (wasWaitingForPublisher && this._sendToWaitingConsumer(value, type)) {
      return true
    }

    assert(this._state == STATE_NORMAL)

    let len = this._buffer.length
    if (len < this._bufferSize) {
      this._buffer.push({ value, type, fnVal: undefined, fnErr: undefined })
      let waiters; if (wasWaitingForPublisher && this._waiters.length) {
        waiters = this._waiters.splice(0)
      }
      if (len == 0) this.emit('takeable')
      // notify all waiters for opportunity to consume
      if (waiters) triggerWaiters(waiters, this._state != STATE_CLOSED)
      return true
    }

    if (wasWaitingForPublisher && this._waiters.length) {
      // The publisher wasn't able to publish synchronously. Probably it will either start
      // waiting for the opportunity to do this again using maybeCanSendSync(), or will just
      // publish asynchronously using send(). The latter case is an opportunity to consume,
      // so notify all waiters for such an opportunity, but do this on the next macrotick to
      // give the publisher time to actually call send().
      let waiters = this._waiters.splice(0)
      schedule.macrotask(() => triggerWaiters(waiters, this._state != STATE_CLOSED))
    }
    
    return false
  }

  _send(value, type, fnVal, fnErr, needsCancelFn) {
    if (this._state >= STATE_CLOSING) {
      fnErr(new Error('attempt to send into a closed channel'))
      return nop
    }

    let wasWaitingForPublisher = this._state == STATE_WAITING_FOR_PUBLISHER
    if (wasWaitingForPublisher && this._sendToWaitingConsumer(value, type)) {
      fnVal(value)
      return nop
    }

    assert(this._state == STATE_NORMAL)

    let cancel
    let len = this._buffer.length
    if (len < this._bufferSize) {
      this._buffer.push({ value, type, fnVal: undefined, fnErr: undefined })
      cancel = nop
      fnVal(value)
    } else {
      let item = { value, type, fnVal, fnErr }
      cancel = () => this._cancelSend(item)
      this._buffer.push(item)
    }

    let waiters; if (wasWaitingForPublisher && this._waiters.length) {
      waiters = this._waiters.splice(0)
    }

    if (len == 0) this.emit('takeable')
    if (waiters) triggerWaiters(waiters, this._state != STATE_CLOSED)
    
    return cancel
  }

  _takeSync() {
    if (this._state == STATE_CLOSED || this._state == STATE_WAITING_FOR_PUBLISHER) {
      return false
    }

    assert(this._state == STATE_NORMAL || this._state == STATE_CLOSING)
    assert(this._state == STATE_NORMAL || this._buffer.length > 0)

    let item = this._takeFromWaitingPublisher()
    if (item === FAILED) {
      assert(this._state == STATE_WAITING_FOR_PUBLISHER)
      if (this._waiters.length && this._buffer.length <= this._bufferSize) {
        // The consumer wasn't able to consume synchronously. Probably it will either start
        // waiting for the opportunity to do this again using maybeCanTakeSync(), or will just
        // consume asynchronously using take(). The latter case is an opportunity to publish,
        // so notify all waiters for such an opportunity, but do this on the next macrotick to
        // give the consumer time to actually call take().
        let waiters = this._waiters.splice(0)
        schedule.macrotask(() => triggerWaiters(waiters, this._state < STATE_CLOSING))
      }
      return false
    }

    let waiters; if (this._state < STATE_CLOSING && this._buffer.length < this._bufferSize) {
      waiters = this._waiters.length ? this._waiters.splice(0) : undefined
    }

    if (this._buffer.length == 0) {
      this.emit('empty')
    }

    if (this._needsDrain && this.canSendSync) {
      this._emitDrain()
    }

    if (waiters) {
      triggerWaiters(waiters, this._state < STATE_CLOSING)
    }

    assert(item.type == SEND_TYPE_VALUE || item.type == SEND_TYPE_ERROR)
    item.fnVal && item.fnVal(item.value)

    if (item.type == SEND_TYPE_ERROR) {
      ERROR.value = item.value
      return ERROR
    }

    return true
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (this._state == STATE_CLOSED) {
      fnVal && fnVal(CLOSED)
      return nop
    }

    let prevState = this._state
    if (prevState != STATE_WAITING_FOR_PUBLISHER) {
      let item = this._takeFromWaitingPublisher()
      if (item !== FAILED) {
        let waiters; if (this._state == STATE_NORMAL && this._buffer.length < this._bufferSize) {
          waiters = this._waiters.length ? this._waiters.splice(0) : undefined
        }
        if (this._buffer.length == 0) {
          this.emit('empty')
        }
        if (this._needsDrain && this.canSendSync) {
          this._emitDrain()
        }
        if (waiters) {
          triggerWaiters(waiters, this._state < STATE_CLOSING)
        }
        assert(item.type == SEND_TYPE_VALUE || item.type == SEND_TYPE_ERROR)
        item.fnVal && item.fnVal(item.value)
        if (item.type == SEND_TYPE_VALUE) {
          fnVal && fnVal(item.value)
        } else {
          fnErr && fnErr(item.value)
        }
        return nop
      }
    }

    assert(this._state == STATE_WAITING_FOR_PUBLISHER)

    let item = { fnVal, fnErr }
    this._buffer.push(item)

    if (prevState == STATE_NORMAL) {
      // notify all waiters for the opportunity to publish
      let waiters = this._waiters.length ? this._waiters.splice(0) : undefined
      if (this._needsDrain) this._emitDrain() // TODO: probably not needed here
      waiters && triggerWaiters(waiters, this._state < STATE_CLOSING)
    }

    return needsCancelFn ? () => { item.fnVal = item.fnErr = undefined } : nop
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    if (this._state == STATE_CLOSED) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_FALSE
      } else {
        fn(false)
        return
      }
    }

    if (this.canTakeSync) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_TRUE
      } else {
        fn(true)
        return
      }
    }

    // STATE_CLOSING should be impossible here, as otherwise this.canTakeSync would be true
    assert(this._state == STATE_NORMAL || this._state == STATE_WAITING_FOR_PUBLISHER)

    let waiters
    if (this._state == STATE_NORMAL) {
      assert(this._buffer.length == 0)
      // there are (maybe) some waiters for opportunity to publish, but no actual publishers
      this._state = STATE_WAITING_FOR_PUBLISHER
      if (this._waiters.length) {
        waiters = this._waiters.splice(0)
      }
    }

    this._waiters.push(fn)
    waiters && triggerWaiters(waiters, true)
  }

  _maybeCanSendSync(fn, mayReturnPromise) {
    if (this._state >= STATE_CLOSING) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_FALSE
      } else {
        fn(false)
        return
      }
    }

    if (this.canSendSync) {
      if (mayReturnPromise) {
        return P_RESOLVED_WITH_TRUE
      } else {
        fn(true)
        return
      }
    }

    assert(this._state == STATE_NORMAL || this._state == STATE_WAITING_FOR_PUBLISHER)

    let waiters
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      // there are (maybe) some waiters for opportunity to consume, but no actual consumers
      this._state = STATE_NORMAL
      if (this._waiters.length) {
        waiters = this._waiters.splice(0)
      }
    }
    
    this._waiters.push(fn)
    waiters && triggerWaiters(waiters, true)
  }

  closeSync() {
    if (this._state == STATE_CLOSED) {
      return true
    }
    if (this._state == STATE_CLOSING) {
      return false
    }
    if (this._state == STATE_WAITING_FOR_PUBLISHER) {
      this._terminateAllOutstandingOpsAndClose()
      return true
    }
    if (this._buffer.length == 0) {
      // there are no real publishers, only (maybe) waiters for opportunity to publish => kill 'em
      this._close(STATE_NORMAL)
      return true
    }
    return false
  }

  close() {
    if (this.closeSync()) {
      assert(this._state == STATE_CLOSED)
      return P_RESOLVED
    }

    assert(this._buffer.length > 0)

    if (this._state == STATE_CLOSING) {
      assert(this._waiters.length > 0)
      assert(this._waiters[ this._waiters.length - 1 ].promise != undefined)
      return this._waiters[ this._waiters.length - 1 ].promise
    }

    assert(this._state == STATE_NORMAL)

    this._state = STATE_CLOSING
    let waiters = this._waiters.length ? this._waiters.splice(0) : undefined

    let resolve, promise = new Promise(res => { resolve = res })
    let fn = _ => resolve()

    fn.promise = promise
    this._waiters.push(fn)

    this.emit('closing')
    
    // notify all send waiters that chan started closing
    waiters && triggerWaiters(waiters, false)

    return promise
  }

  closeNow() {
    this._terminateAllOutstandingOpsAndClose()
  }

  _terminateAllOutstandingOpsAndClose() {
    assert(this._state == STATE_WAITING_FOR_PUBLISHER
      || this._state == STATE_NORMAL
      || this._state == STATE_CLOSING)
    let fromState = this._state
    this._state = STATE_CLOSED
    if (fromState == STATE_WAITING_FOR_PUBLISHER) {
      this._terminateAllOutstandingTakes()
    } else {
      this._terminateAllOutstandingSends()
    }
    this._close(fromState)
  }

  _close(fromState) {
    assert(this._buffer.length == 0)
    this._state = STATE_CLOSED
    this._triggerWaiters(false)
    if (fromState == STATE_CLOSING) {
      this.emit('finish')
    }
    this.emit('closed')
  }

  _takeFromWaitingPublisher() {
    assert(this._state == STATE_NORMAL || this._state == STATE_CLOSING)

    let len = this._buffer.length
    if (len == 0) {
      this._state = STATE_WAITING_FOR_PUBLISHER
      return FAILED
    }

    let item = this._buffer.shift()
    --len

    assert(item != undefined)
    assert(item.type == SEND_TYPE_VALUE
      || item.type == SEND_TYPE_ERROR
      || item.type == SEND_TYPE_INTENT)

    if (item.type == SEND_TYPE_INTENT) {
      item.value = item.value()
      if (item.value === ERROR) {
        item.value = ERROR.value
        item.type = SEND_TYPE_ERROR
      } else {
        item.type = SEND_TYPE_VALUE
        this._value = item.value
      }
    } else if (item.type == SEND_TYPE_VALUE) {
      this._value = item.value
    }

    if (len == 0 && this._state == STATE_CLOSING) {
      this._close(STATE_CLOSING)
    } else {
      let bufferSize = this._bufferSize
      if (bufferSize && len >= bufferSize) {
        // buffer the most long-waiting publisher
        let bItem = this._buffer[ bufferSize - 1 ]
        // need to re-create item to prevent _cancelSend from finding this item
        this._buffer[ bufferSize - 1 ] = {
          value: bItem.value, type: bItem.type,
          fnVal: undefined, fnErr: undefined }
        bItem.fnVal && bItem.fnVal(bItem.value)
      }
    }

    return item
  }

  _cancelSend(item) {
    if (this._state == STATE_CLOSED) {
      return
    }
    let buf = this._buffer
    let index = buf.indexOf(item)
    if (index == -1) return
    // cannot be any other state as otherwise the send would not be blocked
    assert(this._state == STATE_NORMAL || this._state == STATE_CLOSING)
    // the send cannot be buffered
    assert(index >= this._bufferSize)
    buf.splice(index, 1)
    if (buf.length == 0) {
      if (this._state == STATE_CLOSING) {
        this._close(STATE_CLOSING)
      }
      this.emit('empty')
    }
  }

  _sendToWaitingConsumer(value, type) {
    assert(this._state == STATE_WAITING_FOR_PUBLISHER)

    if (this._buffer.length == 0) {
      this._state = STATE_NORMAL
      return false
    }

    let item = this._buffer.shift()

    // skip all cancelled consumers
    while (item && !(item.fnVal || item.fnErr)) {
      item = this._buffer.shift()
    }

    if (!item) {
      assert(this._buffer.length == 0)
      this._state = STATE_NORMAL
      return false
    }

    if (this._buffer.length == 0) {
      this._state = STATE_NORMAL
    }

    if (type == SEND_TYPE_INTENT) {
      value = value()
      if (value === ERROR) {
        item.fnErr && item.fnErr(ERROR.value)
      } else {
        this._value = value
        item.fnVal && item.fnVal(value)
      }
    } else if (type == SEND_TYPE_VALUE) {
      this._value = value
      item.fnVal && item.fnVal(value)
    } else {
      item.fnErr && item.fnErr(value)
    }

    return true
  }

  _triggerWaiters(arg) {
    let waiters = this._waiters
    if (waiters.length) {
      waiters = waiters.splice(0)
      triggerWaiters(waiters, arg)
    }
  }

  _terminateAllOutstandingTakes() {
    assert(this._buffer.findIndex(x => x.type !== undefined) == -1, 'no publishers')
    let buf = this._buffer
    for (let i = 0; i < buf.length; ++i) {
      let item = buf[i]
      item.fnVal && item.fnVal(CLOSED)
    }
    buf.length = 0
  }

  _terminateAllOutstandingSends() {
    assert(this._buffer.findIndex(x => x.type === undefined) == -1, 'no consumers')
    let err = new Error('channel closed')
    let buf = this._buffer
    for (let i = 0; i < buf.length; ++i) {
      let item = buf[i]
      item.fnErr && item.fnErr(err)
    }
    this._buffer.length = 0
  }

  get _constructorName() {
    return 'chan'
  }

  get _constructorArgsDesc() {
    return [ this._bufferSize ]
  }

  get _stateName() {
    let names = ['STATE_NORMAL', 'STATE_WAITING_FOR_PUBLISHER', 'STATE_CLOSING', 'STATE_CLOSED']
    return names[ this._state ]
  }
}


function triggerWaiters(waiters, arg) {
  for (let i = 0; i < waiters.length; ++i) {
    waiters[i](arg)
  }
}
