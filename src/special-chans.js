import {EventEmitterMixin} from './event-emitter'
import {nop} from './utils'
import {CLOSED, FAILED} from './constants'
import {P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'


export class BaseDelayChan {

  constructor(ms) {
    this._initChanBase()
    this._ms = ms
    this._timeoutDate = Date.now() + ms
    this._tid = undefined
    this._consumers = []
    this._timeoutBound = () => this._timeout()
  }

  sendSync(val) {
    throw new Error(`sendSync() is unsupported by ${ this.constructor.name }`)
  }

  send(val) {
    throw new Error(`send() is unsupported by ${ this.constructor.name }`)
  }

  closeSync() {
    throw new Error(`closeSync() is unsupported by ${ this.constructor.name }`)
  }

  close() {
    throw new Error(`close() is unsupported by ${ this.constructor.name }`)
  }

  closeNow() {
    throw new Error(`closeNow() is unsupported by ${ this.constructor.name }`)
  }

  maybeCanTakeSync() {
    if (this.canTakeSync) {
      return P_RESOLVED_WITH_TRUE
    }
    return new Promise(resolve => {
      let fn = val => resolve(val == CLOSED ? false : true)
      this._take(fn, fn, false)
    })
  }

  maybeCanSendSync() {
    return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
  }

  _addConsumer(fn, needsCancelFn, now) {
    if (this._tid == undefined) {
      let delay = Math.max(0, this._timeoutDate - (now || Date.now()))
      this._tid = setTimeout(this._timeoutBound, delay)
    }
    let cons = { fn }
    this._consumers.push(cons)
    return needsCancelFn ? () => this._removeConsumer(cons) : nop
  }

  _removeConsumer(cons) {
    let index = this._consumers.indexOf(cons)
    if (index >= 0) {
      this._consumers.splice(index, 1)
    } else {
      cons.fn = undefined
      return
    }
    if (this._consumers.length == 0 && this._tid != undefined) {
      clearTimeout(this._tid)
      this._tid = undefined
    }
  }

  _timeoutNow() {
    if (this._tid != undefined) {
      clearTimeout(this._tid)
      this._timeout()
    }
  }
}


export class TimeoutChan extends BaseDelayChan
{
  constructor(ms, message) {
    super(ms)
    this._message = message
  }

  get value() {
    return undefined
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  get canTakeSync() {
    return Date.now() >= this._timeoutDate
  }

  get isClosingOrClosed() {
    return false
  }

  get isClosed() {
    return false
  }

  takeSync() {
    if (Date.now() < this._timeoutDate) {
      return false
    }
    this._timeoutNow()
    throw this._makeError()
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (!fnErr) {
      return nop
    }
    let now = Date.now()
    if (now >= this._timeoutDate) {
      this._timeoutNow()
      fnErr(this._makeError())
      return nop
    }
    return this._addConsumer(fnErr, needsCancelFn, now)
  }

  _timeout() {
    this._timeoutDate = 0
    this._tid = undefined
    if (this._consumers.length) {
      let err = this._makeError()
      while (this._consumers.length) {
        let fn = this._consumers.shift().fn
        fn && fn(err)
      }
    }
  }

  _makeError() {
    return new Error(this._message || `timeout of ${ this._ms } ms exceeded`)
  }

  get _constructorName() {
    return 'chan.timeout'
  }

  get _constructorArgsDesc() {
    return this._message ? [ this._ms, this._message ] : [ this._ms ]
  }
}


export class DelayChan extends BaseDelayChan
{
  constructor(ms, value) {
    super(ms)
    this._value = value
    this._closed = false
  }

  get value() {
    return this._closed ? this._value : undefined
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  get canTakeSync() {
    return !this._closed && Date.now() >= this._timeoutDate
  }

  get isClosingOrClosed() {
    return this._closed
  }

  get isClosed() {
    return this._closed
  }

  takeSync() {
    if (!this.canTakeSync) {
      return false
    }
    this._close()
    return true
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (this._closed) {
      return fnVal(CLOSED)
    }
    return this._addConsumer(fnVal, needsCancelFn)
  }

  closeSync() {
    if (!this._closed) {
      this._close()
    }
    return true
  }

  close() {
    if (!this._closed) {
      this._close()
    }
    return P_RESOLVED
  }

  _timeout() {
    this._tid = undefined
    this._closed = true
    let sent = false
    while (this._consumers.length && !sent) {
      let fn = this._consumers.shift().fn
      if (fn) {
        let value = this._value
        if ('function' == typeof value) {
          value = value()
        }
        fn(value)
        sent = true
      }
    }
    this._close()
  }

  _close() {
    this._closed = true
    if (this._tid != undefined) {
      clearTimeout(this._tid)
      this._tid = undefined
    }
    while (this._consumers.length) {
      let fn = this._consumers.shift().fn
      fn && fn(CLOSED)
    }
  }

  get _constructorName() {
    return 'chan.delay'
  }

  get _constructorArgsDesc() {
    return this._value ? [ this._ms, this._value ] : [ this._ms ]
  }
}
