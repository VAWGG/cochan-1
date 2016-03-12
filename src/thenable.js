import {nop} from './utils'

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
    this._chan = chan
    this._op = op
    this._cancel = nop
    this._subs = undefined
    this._result = undefined
    this._fulfill_bnd = undefined
    this._reject_bnd = undefined
  }

  then(onFulfilled, onRejected) {
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
      let subs = this._subs, newSub = {
        onFulfilled: onFulfilled ? wrapHandler(onFulfilled, resolve, reject) : resolve,
        onRejected: onRejected ? wrapHandler(onRejected, resolve, reject) : reject
      }
      if (!subs) {
        this._subs = newSub
      } else if (subs.constructor === Object) {
        this._subs = [ subs, newSub ]
      } else {
        subs.push(newSub)
      }
    })
  }

  catch(onRejected) {
    return this.then(undefined, onRejected)
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
    return this
  }

  get _fulfillBound() {
    return this._fulfill_bnd || (this._fulfill_bnd = val => {
      this._fulfill_bnd = undefined
      this._reject_bnd = undefined
      this._fulfill(val)
    })
  }

  get _rejectBound() {
    return this._reject_bnd || (this._reject_bnd = err => {
      this._fulfill_bnd = undefined
      this._reject_bnd = undefined
      this._reject(err)
    })
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
