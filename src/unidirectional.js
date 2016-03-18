import {ISCHAN, P_RESOLVED_WITH_FALSE, P_RESOLVED_WITH_TRUE} from './constants'
import schedule from './schedule'


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

  maybeCanTakeSync() {
    return this._chan.maybeCanTakeSync()
  }

  takeSync() {
    return this._chan.takeSync()
  }

  take() {
    let thenable = this._chan.take()
    thenable._chan = this
    return thenable
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

  get _ischan() {
    return ISCHAN
  }

  get takeOnly() {
    return this
  }

  get sendOnly() {
    throw new Error(`Cannot convert take-only chan ${this} into a send-only one`)
  }

  get canSend() {
    return false
  }

  get canSendSync() {
    return false
  }

  sendErrorSync(err) {
    throw new Error(`Cannot send into take-only chan ${this}`)
  }

  sendError(err, close) {
    throw new Error(`Cannot send into take-only chan ${this}`)
  }

  sendSync(val) {
    throw new Error(`Cannot send into take-only chan ${this}`)
  }

  send(val) {
    throw new Error(`Cannot send into take-only chan ${this}`)
  }

  maybeCanSendSync() {
    return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
  }

  closeSync() {
    throw new Error(`Cannot close take-only chan ${this}`)
  }

  close() {
    throw new Error(`Cannot close take-only chan ${this}`)
  }

  closeNow() {
    throw new Error(`Cannot close take-only chan ${this}`)
  }

  // writable stream

  write(chunk, encoding, cb) {
    let err = new Error(`Cannot write into take-only chan ${this}`)
    schedule.microtask(() => {
      cb && cb(err)
      this.emit('error', err)
    })
  }

  end(chunk, encoding, cb) {
    this.write(chunk, encoding, cb)
  }

  cork() {
    throw new Error(`Cannot cork take-only chan ${this}`)
  }

  uncork() {
    throw new Error(`Cannot uncork take-only chan ${this}`)
  }

  setDefaultEncoding(encoding) {
    throw new Error(`Cannot set default encoding on take-only chan ${this}`)
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

  sendErrorSync(err) {
    return this._chan.sendErrorSync(err)
  }

  sendError(err, close) {
    return this._chan.sendError(err, close)
  }

  sendSync(val) {
    return this._chan.sendSync(val)
  }

  send(val) {
    let thenable = this._chan.send(val)
    thenable._chan = this
    return thenable
  }

  maybeCanSendSync() {
    return this._chan.maybeCanSendSync()
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

  get _ischan() {
    return ISCHAN
  }

  get sendOnly() {
    return this
  }

  get takeOnly() {
    throw new Error(`Cannot convert send-only chan ${this} into a take-only one`)
  }

  get canTake() {
    return false
  }

  get canTakeSync() {
    return false
  }

  maybeCanTakeSync() {
    return this.isClosed ? P_RESOLVED_WITH_FALSE : P_RESOLVED_WITH_TRUE
  }

  takeSync() {
    throw new Error(`Cannot take from send-only chan ${this}`)
  }

  take() {
    throw new Error(`Cannot take from send-only chan ${this}`)
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
}
