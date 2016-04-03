import assert from 'power-assert'
import schedule from './schedule'
import {OP_TAKE, OP_SEND, THENABLE_MIXED_USE_MSG} from './constants'
import {SEND_TYPE_VALUE, SEND_TYPE_ERROR} from './constants'
import {arrayPool} from './pools'

const DEBUG = true
let nextId = 0|0

export class Thenable {

  constructor(chan, op) {
    if (DEBUG) {
      this._id = ++nextId
    }
    this._chan = chan
    this._state = op|0 // _op = op, non-sealed
  }

  then(onFulfilled, onRejected) {
    if (this._isSealed) {
      throw new Error(THENABLE_MIXED_USE_MSG)
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
    this._settle(value, false)
    return this
  }

  _reject(value) {
    this._settle(value, true)
    return this
  }

  _settle(value, isError) {
    if (this._result) {
      return
    }
    this._result = { value, isError }
    if (!this._subs) {
      return
    }
    if (this._isSealed) {
      this._notify()
    } else {
      schedule.microtask(() => this._notify())
    }
  }

  _notify() {
    assert(this._subs != undefined)
    let {value, isError} = this._result
    let subs = this._subs
    this._subs = undefined
    if (subs.constructor === Object) {
      return isError ? subs.onRejected(value) : subs.onFulfilled(value)
    }
    if (isError) {
      for (let i = 0, l = subs.length; i < l; ++i) {
        subs[i].onRejected(value)
      }
    } else {
      for (let i = 0, l = subs.length; i < l; ++i) {
        subs[i].onFulfilled(value)
      }
    }
    arrayPool.put(subs)
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
      }, result = ${ describeBox(this._result)
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
    ? pair.isError || pair.type == SEND_TYPE_ERROR
      ? `Error(${pair.value})`
      : pair.type == SEND_TYPE_VALUE
        ? `Value(${pair.value})`
        : `SendIntent(fn.${ pair.value.name || 'anon' })`
    : `<no>`
}

Thenable.prototype._cancel = undefined
Thenable.prototype._subs = undefined
Thenable.prototype._result = undefined
Thenable.prototype._bound_ = undefined
