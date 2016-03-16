import {OP_TAKE, OP_SEND, THENABLE_INVALID_USE_MSG} from './constants'
import {arrayPool} from './pools'

const DEBUG = true
let nextId = 0|0

export class Thenable {

  static resolve(value, chan, op) {
    let thenable = new Thenable(chan, op)
    thenable._result = { value, isError: false }
    return thenable
  }

  static reject(value, chan, op) {
    let thenable = new Thenable(chan, op)
    thenable._result = { value, isError: true }
    return thenable
  }

  constructor(chan, op) {
    if (DEBUG) {
      this._id = ++nextId
    }
    this._chan = chan
    this._state = op|0 // _op = op, non-sealed, _reuseId = 0
  }

  then(onFulfilled, onRejected) {
    if (this._isSealed) {
      throw new Error(THENABLE_INVALID_USE_MSG)
    }
    return new Promise((resolve, reject) => {
      let result = this._result
      if (result) {
        if (result.isError) {
          if (onRejected) {
            resolve(onRejected(result.value))
          } else {
            reject(result.value)
          }
        } else {
          resolve(onFulfilled ? onFulfilled(result.value) : result.value)
        }
        return
      }
      this._addSub({
        onFulfilled: onFulfilled ? wrapHandler(onFulfilled, resolve, reject) : resolve,
        onRejected: onRejected ? wrapHandler(onRejected, resolve, reject) : reject
      })
    })
  }

  catch(onRejected) {
    return this.then(undefined, onRejected)
  }

  get _op() {
    return this._state & 0b11
  }

  set _op(op) {
    this._state = (this._state & ~0b11) | op
  }

  get _isSealed() {
    return this._state & 0b100
  }

  _seal() {
    this._state |= 0b100
  }

  _unseal() {
    this._state &= ~0b100
  }

  _addSub(newSub /* = { onFulfilled, onRejected } */) {
    let subs = this._subs
    if (!subs) {
      this._subs = newSub
    } else if (subs.constructor === Object) {
      this._subs = arrayPool.take()
      this._subs.push(subs)
      this._subs.push(newSub)
    } else {
      subs.push(newSub)
    }
  }

  _fulfill(value) {
    this._result = { value, isError: false }
    let subs = this._subs
    if (!subs) {
      return this
    }
    this._subs = undefined
    if (subs.constructor === Object) {
      subs.onFulfilled(value)
      return this
    }
    for (let i = 0, l = subs.length; i < l; ++i) {
      subs[i].onFulfilled(value)
    }
    arrayPool.put(subs)
    return this
  }

  _reject(value) {
    this._result = { value, isError: true }
    let subs = this._subs
    if (!subs) {
      return this
    }
    this._subs = undefined
    if (subs.constructor === Object) {
      subs.onRejected(value)
      return this
    }
    for (let i = 0, l = subs.length; i < l; ++i) {
      subs[i].onRejected(value)
    }
    arrayPool.put(subs)
    return this
  }

  get _bound() {
    return this._bound_ || (this._bound_ = {
      fulfill: (val) => {
        this._bound_ = undefined
        this._fulfill(val)
      },
      reject: (err) => {
        this._bound_ = undefined
        this._reject(err)
      }
    })
  }

  toString() {
    return `Thenable(${ DEBUG ? this._id + ', ' : ''
      }chan = ${ this._chan || '<no>'
      }, op = ${ this._op == OP_TAKE ? 'take' :
         this._op == OP_SEND ? 'send ' + describeBox(this._sendData) : '<no>'
      }, result = ${ this._result ? describeBox(this._result) : '<no>'
      }, rid = ${ this._reuseId
      }, seal = ${ this._isSealed ? 1 : 0
      })`
  }

  inspect() {
    return this.toString()
  }
}

function wrapHandler(handler, resolve, reject) {
  return function tryCatch(val) {
    try {
      resolve(handler(val))
    } catch (err) {
      reject(err)
    }
  }
}

function describeBox(pair) {
  return pair
    ? pair.isError ? `Error(${pair.value})` : `Value(${pair.value})`
    : '<no>'
}

Thenable.prototype._cancel = undefined
Thenable.prototype._subs = undefined
Thenable.prototype._result = undefined
Thenable.prototype._bound_ = undefined
