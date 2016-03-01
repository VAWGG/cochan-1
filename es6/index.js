import BaseChan from './base-chan'
import {P_RESOLVED, CLOSED, FAILED, nop} from './constants'
import {TimeoutChan, DelayChan} from './special-chans'
import {trySelect, select} from './select'
import applyEventEmitter from './apply-event-emitter'


const STATE_NORMAL = 0
const STATE_HAS_WAITING_CONSUMERS = 1
const STATE_CLOSING = 2
const STATE_CLOSED = 3


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

  static fromEventEmitter(emitter, bufferSize = 0) {
    let chan = new Chan(bufferSize)
    applyEventEmitter(emitter, chan, true, true)
    return chan
  }

  constructor(bufferSize = 0) {
    super()
    this._state = STATE_NORMAL
    this._bufferSize = bufferSize
    this._buffer = []
  }

  get mayHaveMore() {
    return this._state < STATE_CLOSING || !!this._buffer.length
  }

  get hasMore() {
    return this._state != STATE_HAS_WAITING_CONSUMERS && !!this._buffer.length
  }

  get isClosingOrClosed() {
    return this._state >= STATE_CLOSING
  }

  tryPutError(err) {
    return this.tryPut(err, true)
  }

  putError(err, close) {
    if (close) {
      return this.put(err, true).then(() => this.close())
    } else {
      return this.put(err, true)
    }
  }

  tryPut(val, isError) {
    if (this._state >= STATE_CLOSING) {
      throw new Error('attempt to put into a closed channel')
    }
    if (this._state == STATE_HAS_WAITING_CONSUMERS && this._sendToWaitingConsumer(val, isError)) {
      return true
    }
    if (this._state == STATE_NORMAL && this._buffer.length < this._bufferSize) {
      this._buffer.push({ val, isError, fnVal: undefined, fnErr: undefined })
      return true
    }
    return false
  }

  put(val, isError) {
    if (this._state >= STATE_CLOSING) {
      return Promise.reject(new Error('attempt to put into a closed channel'))
    }

    if (this._state == STATE_HAS_WAITING_CONSUMERS && this._sendToWaitingConsumer(val, isError)) {
      return P_RESOLVED
    } // else state is STATE_NORMAL

    if (this._buffer.length < this._bufferSize) {
      this._buffer.push({ val, isError, fnVal: undefined, fnErr: undefined })
      return P_RESOLVED
    }

    return new Promise((res, rej) => {
      this._buffer.push({ val, isError, fnVal: res, fnErr: rej })
    })
  }

  tryTake() {
    if (this._state == STATE_CLOSED) {
      return CLOSED
    }

    if (this._state == STATE_HAS_WAITING_CONSUMERS || this._buffer.length == 0) {
      return FAILED
    } // else state is either STATE_NORMAL or STATE_CLOSING

    let item = this._buffer.shift()
    let closeFns = undefined

    if (this._state == STATE_CLOSING && this._buffer.length == 1) {
      this._state = STATE_CLOSED
      closeFns = this._buffer.shift().fns
    }

    item.fnVal && item.fnVal()
    
    if (closeFns) {
      for (let i = 0; i < closeFns.length; ++i) {
        closeFns[i]()
      }
    }

    if (item.isError) {
      throw item.val
    }

    return item.val
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (this._state == STATE_CLOSED) {
      fnVal && fnVal(CLOSED)
      return nop
    }

    if (this._state == STATE_HAS_WAITING_CONSUMERS || this._buffer.length == 0) {
      let item = { fnVal, fnErr, consumes: true }
      this._buffer.push(item)
      this._state = STATE_HAS_WAITING_CONSUMERS
      return needsCancelFn
        ? () => { item.fnVal = undefined; item.fnErr = undefined; item.consumes = false }
        : nop
    }

    let item = this._buffer.shift()
    let closeFns = undefined

    if (this._state == STATE_CLOSING && this._buffer.length == 1) {
      this._state = STATE_CLOSED
      closeFns = this._buffer.shift().fns
    }

    let fn = item.isError ? fnErr : fnVal
    fn && fn(item.val)

    if (closeFns) {
      for (let i = 0; i < closeFns.length; ++i) {
        closeFns[i]()
      }
    }

    return nop
  }

  wait() {
    if (this._state == STATE_CLOSED) {
      return P_RESOLVED
    }
    if (this._state == STATE_HAS_WAITING_CONSUMERS || this._buffer.length == 0) {
      this._state = STATE_HAS_WAITING_CONSUMERS
      return new Promise(resolve => {
        this._buffer.push({ fnVal: resolve, fnErr: resolve, consumes: false })
      })
    }
    return P_RESOLVED
  }

  tryClose() {
    if (this._state == STATE_CLOSED) {
      return true
    }
    if (this._buffer.length == 0) {
      this._state = STATE_CLOSED
      return true
    }
    if (this._state == STATE_HAS_WAITING_CONSUMERS) {
      this._state = STATE_CLOSED
      this._terminateAllWaitingConsumers()
      return true
    }
    return false
  }

  close() {
    if (this._state == STATE_CLOSED) {
      return P_RESOLVED
    }

    if (this._buffer.length == 0) {
      this._state = STATE_CLOSED
      return P_RESOLVED
    }

    if (this._state == STATE_HAS_WAITING_CONSUMERS) {
      this._state = STATE_CLOSED
      this._terminateAllWaitingConsumers()
      return P_RESOLVED
    }

    let resolve
    let promise = new Promise(res => { resolve = res })

    if (this._state == STATE_CLOSING) {
      this._buffer[ this._buffer.length - 1 ].fns.push(resolve)
      return promise
    }

    this._buffer.push({ fns: [resolve] })
    this._state = STATE_CLOSING

    return promise
  }

  closeNow() {
    if (this._state == STATE_CLOSED) {
      return
    }

    let prevState = this._state
    this._state = STATE_CLOSED

    if (prevState == STATE_HAS_WAITING_CONSUMERS) {
      this._terminateAllWaitingConsumers()
      return P_RESOLVED
    }

    if (prevState == STATE_CLOSING) {
      let fns = this._buffer.pop().fns
      for (let i = 0; i < fns.length; ++i) {
        fns[i]()
      }
    }

    let err = new Error('channel closed')

    while (this._buffer.length) {
      let {fnErr} = this._buffer.shift()
      fnErr && fnErr(err)
    }
  }

  _sendToWaitingConsumer(val, isError) {
    let item = this._buffer.shift()
    while (item && !item.consumes) {
      let fn = isError ? item.fnErr : item.fnVal
      fn && fn()
      item = this._buffer.shift()
    }
    if (!item) {
      this._state = STATE_NORMAL
      return false
    }
    let fn = isError ? item.fnErr : item.fnVal
    fn && fn(val)
    if (this._buffer.length == 0) {
      this._state = STATE_NORMAL
    }
    return true
  }

  _terminateAllWaitingConsumers() {
    while (this._buffer.length) {
      let item = this._buffer.shift()
      item.fnVal && item.fnVal(item.consumes ? CLOSED : undefined)
    }
  }
}


Chan.CLOSED = CLOSED
Chan.FAILED = FAILED

Chan.trySelect = trySelect
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
