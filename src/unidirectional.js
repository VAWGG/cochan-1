import {ISCHAN, P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'
import schedule from './schedule'
import {mixin} from './utils'


class UnidirectionalProxyBase {

  get _ischan() {
    return ISCHAN
  }

  withDesc(desc) {
    return withDesc(desc, this)
  }

  // event emitter proxy

  addListener(event, fn) {
    this._chan.addListener(event, fn)
    return this
  }

  on(event, fn) {
    this._chan.on(event, fn)
    return this
  }

  addListenerOnce(event, fn) {
    this._chan.addListenerOnce(event, fn)
    return this
  }

  once(event, fn) {
    this._chan.once(event, fn)
    return this
  }

  removeListener(event, fn) {
    this._chan.removeListener(event, fn)
    return this
  }

  removeAllListeners(event) {
    this._chan.removeAllListeners(event)
    return this
  }

  listenerCount(event) {
    return this._chan.listenerCount(event)
  }

  listeners(event) {
    return this._chan.listeners(event)
  }

}

//
// TODO: test piping Streams3 stream into a send-only chan
//

export class TakeOnlyChanProxy {

  constructor(chan) {
    this._chan = chan
  }

  get isClosed() {
    return this._chan.isClosed
  }

  get isActive() {
    return this._chan.isActive
  }

  get value() {
    return this._chan.value
  }

  get canTake() {
    return this._chan.canTake
  }

  get canTakeSync() {
    return this._chan.canTakeSync
  }

  _maybeCanTakeSync(fn, mayReturnPromise) {
    return this._chan._maybeCanTakeSync(fn, mayReturnPromise)
  }

  _takeSync() {
    return this._chan._takeSync()
  }

  _take(fnVal, fnErr, needsCancelFn) {
    return this._chan._take(fnVal, fnErr, needsCancelFn)
  }

  get _constructorName() {
    return this._chan._constructorName
  }

  get _constructorArgsDesc() {
    return this._chan._constructorArgsDesc
  }

  get _displayFlags() {
    return '<-' + this._chan._displayFlags
  }

  get _desc() {
    return this.__desc || prependDescFlags('<-', this._chan._desc)
  }

  get takeOnly() {
    return this
  }

  get sendOnly() {
    throw new Error(`cannot convert take-only chan ${this} into a send-only one`)
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  _sendSync(value, type) {
    this._throwCannotSend()
  }

  sendError(err, close) {
    this._throwCannotSend()
  }

  send(val) {
    this._throwCannotSend()
  }

  _send(value, type, fnVal, fnErr, needsCancelFn) {
    this._throwCannotSend()
  }

  _maybeCanSendSync(fn, mayReturnPromise) {
    if (mayReturnPromise) {
      return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
    } else {
      fn(!this.isClosed)
    }
  }

  closeSync() {
    this._throwCannotClose()
  }

  closeNow() {
    this._throwCannotClose()
  }

  close() {
    this._throwCannotClose()
  }

  // event emitter

  emit(/* event, ...args */) {
    throw new Error(`manually emitting events from a take-only chan ${this} is not supported`)
  }

  // writable stream

  write(chunk, encoding, cb) {
    let err = new Error(`cannot write into take-only chan ${this}`)
    schedule.microtask(() => {
      cb && cb(err)
      this.emit('error', err)
    })
  }

  end(chunk, encoding, cb) {
    this.write(chunk, encoding, cb)
  }

  cork() {
    throw new Error(`cannot cork take-only chan ${this}`)
  }

  uncork() {
    throw new Error(`cannot uncork take-only chan ${this}`)
  }

  setDefaultEncoding(encoding) {
    throw new Error(`cannot set default encoding on take-only chan ${this}`)
  }

  _throwCannotSend() {
    throw new Error(`cannot send into take-only chan ${this}`)
  }

  _throwCannotClose() {
    throw new Error(`cannot close take-only chan ${this}`)
  }
}


export class SendOnlyChanProxy {

  constructor(chan) {
    this._chan = chan
  }

  get isClosed() {
    return this._chan.isClosed
  }

  get isActive() {
    return this._chan.isActive
  }

  get value() {
    return undefined
  }

  get canSend() {
    return this._chan.canSend
  }

  get canSendSync() {
    return this._chan.canSendSync
  }

  _send(value, type, fnVal, fnErr, needsCancelFn) {
    return this._chan._send(value, type, fnVal, fnErr, needsCancelFn)
  }

  _sendSync(value, type) {
    return this._chan._sendSync(value, type)
  }

  _maybeCanSendSync(fn, mayReturnPromise) {
    return this._chan._maybeCanSendSync(fn, mayReturnPromise)
  }

  closeSync() {
    return this._chan.closeSync()
  }

  close() {
    return this._chan.close()
  }

  closeNow() {
    return this._chan.closeNow()
  }

  get _constructorName() {
    return this._chan._constructorName
  }

  get _constructorArgsDesc() {
    return this._chan._constructorArgsDesc
  }

  get _displayFlags() {
    return '->' + this._chan._displayFlags
  }

  get _desc() {
    return this.__desc || prependDescFlags('->', this._chan._desc)
  }

  get sendOnly() {
    return this
  }

  get takeOnly() {
    throw new Error(`cannot convert send-only chan ${this} into a take-only one`)
  }

  get canTake() {
    return false
  }

  get canTakeSync() {
    return false
  }

  _maybeCanSendSync(fn, mayReturnPromise) {
    if (mayReturnPromise) {
      return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
    } else {
      fn(!this.isClosed)
    }
  }

  takeSync() {
    this._throwCannotTake()
  }

  take() {
    this._throwCannotTake()
  }

  _take(fnVal, fnErr, needsCancelFn) {
    this._throwCannotTake()
  }

  // event emitter

  emit(/* event, ...args */) {
    this._chan.emit.apply(this._chan, arguments)
  }

  // writable stream

  write(chunk, encoding, cb) {
    return this._chan.write(chunk, encoding, cb)
  }

  end(chunk, encoding, cb) {
    return this._chan.end(chunk, encoding, cb)
  }

  cork() {
    this._chan.cork()
  }

  uncork() {
    this._chan.uncork()
  }

  setDefaultEncoding(encoding) {
    this._chan.setDefaultEncoding(encoding)
  }

  _throwCannotTake() {
    throw new Error(`cannot take from send-only chan ${this}`)
  }
}


function prependDescFlags(flags, desc) {
  return !desc ? desc : {
    constructorName: desc.constructorName,
    constructorArgs: desc.constructorArgs,
    flags: desc.flags == null ? undefined : typeof desc.flags == 'function'
      ? ch => flags + desc.flags(ch)
      : flags + desc.flags,
    name: desc.name
  }
}


function withDesc(desc, ch) {
  if (desc != ch.__desc) {
    ch.__desc = desc
  }
  return ch
}


mixin(TakeOnlyChanProxy, UnidirectionalProxyBase.prototype)
mixin(SendOnlyChanProxy, UnidirectionalProxyBase.prototype)
