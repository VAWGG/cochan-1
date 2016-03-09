import assert from 'power-assert'
import {EventEmitterMixin} from './event-emitter'
import {nop, mixin} from './utils'
import {CLOSED, FAILED} from './constants'
import {P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'


// requires: implement get _isSubscribed, _subscribe(), _unsubscribe()
//
export class SpecialChan {

  constructor() {
    this._initChanBase()
    this._consumers = []
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  maybeCanSendSync() {
    return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
  }

  sendSync(val) {
    throw new Error(`sendSync() is unsupported by ${ this.constructor.name }`)
  }

  send(val) {
    throw new Error(`send() is unsupported by ${ this.constructor.name }`)
  }

  _addConsumer(cons, needsCancelFn, now) {
    this._consumers.push(cons)
    if (!this._isSubscribed) {
      this._subscribe(now)
    }
    return needsCancelFn ? () => this._removeConsumer(cons) : nop
  }

  _removeConsumer(cons) {
    let index = this._consumers.indexOf(cons)
    if (index >= 0) {
      this._consumers.splice(index, 1)
      if (this._consumers.length == 0 && this._isSubscribed) {
        this._unsubscribe()
      }
    }
  }
}


// requires: call _initDelayChanBase(), implement _timeout()
//
class DelayChanMixin {

  _initDelayChanBase(ms) {
    this._ms = ms
    this._timeoutDate = Date.now() + ms
    this._tid = undefined
    this._timeoutBound = () => {
      this._tid = undefined
      this._timeoutDate = 0
      this._timeout()
    }
  }

  get _isSubscribed() {
    return this._tid != undefined
  }

  _subscribe(now) {
    assert(!this._isSubscribed)
    let delay = Math.max(0, this._timeoutDate - (now || Date.now()))
    this._tid = setTimeout(this._timeoutBound, delay)
  }

  _unsubscribe() {
    assert(this._isSubscribed)
    clearTimeout(this._tid)
    this._tid = undefined
  }
}


export class TimeoutChan extends SpecialChan { // mixins: DelayChanMixin

  constructor(ms, message) {
    super()
    this._initDelayChanBase(ms)
    this._message = message
  }

  get value() {
    return undefined
  }

  get isClosed() {
    return false
  }

  get isClosingOrClosed() {
    return false
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

  get canTakeSync() {
    return Date.now() >= this._timeoutDate
  }

  maybeCanTakeSync() {
    if (this.canTakeSync) {
      return P_RESOLVED_WITH_TRUE
    }
    return new Promise(resolve => {
      let fn = () => resolve(true)
      this._take(undefined, fn, false)
    })
  }

  takeSync() {
    if (Date.now() < this._timeoutDate) {
      return false
    }
    this._triggerNow()
    throw this._makeError()
  }

  _take(fnVal, fnErr, needsCancelFn) {
    if (!fnErr) {
      return nop
    }
    let now = Date.now()
    if (now >= this._timeoutDate) {
      this._triggerNow()
      fnErr(this._makeError())
      return nop
    }
    return this._addConsumer(fnErr, needsCancelFn, now)
  }

  _timeout() {
    if (this._consumers.length) {
      let err = this._makeError()
      while (this._consumers.length) {
        this._consumers.shift()(err)
      }
    }
  }

  _triggerNow() {
    if (this._isSubscribed) {
      this._unsubscribe()
      this._timeout()
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


// requires: init _closed = false, implement get _value, get _isError, get _isTriggered
//
class OneTimeChanMixin {

  get value() {
    return this._closed ? this._value : undefined
  }

  get isClosed() {
    return this._closed
  }

  get isClosingOrClosed() {
    return this._closed
  }

  get canTakeSync() {
    return !this._closed && this._isTriggered
  }

  maybeCanTakeSync() {
    if (this.canTakeSync) {
      return P_RESOLVED_WITH_TRUE
    }
    if (this._closed) {
      return P_RESOLVED_WITH_FALSE
    }
    return new Promise(resolve => {
      let fn = val => resolve(val !== CLOSED)
      this._addConsumer({ fnVal: fn, fnErr: fn, consumes: false }, false, 0)
    })
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
      return fnVal && fnVal(CLOSED)
    }
    return this._addConsumer({ fnVal, fnErr, consumes: true }, needsCancelFn, 0)
  }

  closeSync() {
    if (!this._closed) {
      this._close()
    }
    return true
  }

  close() {
    this.closeSync()
    return P_RESOLVED
  }

  closeNow() {
    this.close()
  }

  _closeIfSent() {
    if (this._isSubscribed) {
      this._unsubscribe()
    }
    let cIndex = -1
    for (let i = 0; cIndex == -1 && i < this._consumers.length; ++i) {
      let item = this._consumers[i]
      if (item.consumes) {
        cIndex = i
      }
    }
    if (cIndex != -1) {
      let cons = this._consumers.splice(cIndex, 1)[0]
      let fn = this._isError ? cons.fnErr : cons.fnVal
      fn && fn(this._value)
      this._close()
    }
  }

  _close() {
    this._closed = true
    if (this._isSubscribed) {
      this._unsubscribe()
    }
    while (this._consumers.length) {
      let {fnVal} = this._consumers.shift()
      fnVal && fnVal(CLOSED)
    }
  }
}


export class DelayChan extends SpecialChan { // mixins: DelayChanMixin, OneTimeChanMixin

  constructor(ms, value, isError = false) {
    super()
    this._initDelayChanBase(ms)
    this._value = value
    this._isError = isError
    this._closed = false
  }

  get _isTriggered() {
    return Date.now() >= this._timeoutDate
  }

  _timeout() {
    if (!this._closed) {
      this._closeIfSent()
    }
  }

  get _constructorName() {
    return 'chan.delay'
  }

  get _constructorArgsDesc() {
    return this._value ? [ this._ms, this._value ] : [ this._ms ]
  }
}


export class PromiseChan extends SpecialChan { // mixins: OneTimeChanMixin

  constructor(promise) {
    super()
    this._value = undefined
    this._isError = false
    this._closed = false
    this._promise = promise.then(v => this._onSettled(v, false), e => this._onSettled(e, true))
  }

  get _isTriggered() {
    return !this._promise
  }

  _onSettled(value, isError) {
    this._promise = undefined
    if (!this._closed) {
      this._value = value
      this._isError = isError
      this._closeIfSent()
    }
  }

  get _isSubscribed() { return !!this._promise }
  _subscribe() {}
  _unsubscribe() {}

  get _constructorName() {
    return 'chan.fromPromise'
  }

  get _constructorArgsDesc() {
    return []
  }
}


mixin(TimeoutChan, DelayChanMixin.prototype)

mixin(DelayChan, DelayChanMixin.prototype)
mixin(DelayChan, OneTimeChanMixin.prototype)

mixin(PromiseChan, OneTimeChanMixin.prototype)
