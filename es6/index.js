
const CLOSED = { desc: '<closed>', inspect: () => '<closed>', toString: () => '<closed>' }
const FAILED = { desc: '<failed>', inspect: () => '<failed>', toString: () => '<failed>' }

const P_RESOLVED = Promise.resolve()

const STATE_NORMAL = 0
const STATE_HAS_WAITING_CONSUMERS = 1
const STATE_CLOSING = 2
const STATE_CLOSED = 3


class Chan
{
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  static timeout(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message || `timeout of ${ms} ms exceeded`)), ms)
    })
  }

  static trySelect(chans) {
    if (arguments.length > 1) {
      chans = arguments
    }
    let anyNotClosed = false
    for (let i = 0; i < chans.length; ++i) {
      let val = chans[i].tryTake()
      if (val !== CLOSED) {
        if (val !== FAILED) {
          return val
        }
        anyNotClosed = true
      }
    }
    return anyNotClosed ? FAILED : CLOSED
  }

  static select(chans) {
    let val = Chan.trySelect.apply(Chan, arguments)
    if (val !== FAILED) {
      return Promise.resolve(val)
    }

    if (arguments.length > 1) {
      chans = arguments
    }

    let fnVal, fnErr
    let promise = new Promise((res, rej) => { fnVal = res; fnErr = rej })
    let cancelFns = []
    let numClosed = 0

    for (let i = 0; i < chans.length; ++i) {
      let chan = chans[i]
      if (chan.mayHaveMore) {
        cancelFns.push(chan.takeExt(onValue, onError, true))
      }
    }

    function onValue(val) {
      if (val === CLOSED && ++numClosed < cancelFns.length) {
        return
      }
      unsub()
      fnVal(val)
    }

    function onError(err) {
      unsub()
      fnErr(err)
    }

    function unsub() {
      for (let i = 0; i < cancelFns.length; ++i) {
        cancelFns[i]()
      }
    }

    return promise
  }

  constructor(bufferSize = 0) {
    this._state = STATE_NORMAL
    this._bufferSize = bufferSize
    this._buffer = []
  }

  get mayHaveMore() {
    return this._state < STATE_CLOSING || this._buffer.length
  }

  get isClosingOrClosed() {
    return this._state >= STATE_CLOSING
  }

  get isClosing() {
    return this._state == STATE_CLOSING
  }

  get isClosed() {
    return this._state == STATE_CLOSED
  }

  tryPut(val) {
    if (this._state == STATE_HAS_WAITING_CONSUMERS && this._sendToWaitingConsumer(val)) {
      return true
    }
    if (this._state == STATE_NORMAL && this._buffer.length < this._bufferSize) {
      this._buffer.push({ val, fnVal: undefined, fnErr: undefined })
      return true
    }
    return false
  }

  put(val) {
    if (this._state >= STATE_CLOSING) {
      return Promise.reject(new Error('attempt to put into a closed channel'))
    }

    if (this._state == STATE_HAS_WAITING_CONSUMERS && this._sendToWaitingConsumer(val)) {
      return P_RESOLVED
    } // else state is STATE_NORMAL

    if (this._buffer.length < this._bufferSize) {
      this._buffer.push({ val, fnVal: undefined, fnErr: undefined })
      return P_RESOLVED
    }

    return new Promise((res, rej) => {
      this._buffer.push({ val, fnVal: res, fnErr: rej })
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
    item.fnVal && item.fnVal()
    
    if (this._state == STATE_CLOSING && this._buffer.length == 1) {
      let fns = this._buffer[0].fns
      for (let i = 0; i < fns.length; ++i) {
        fns[i]()
      }
      this._close()
    }

    return item.val
  }

  take() {
    return new Promise((res, rej) => this.takeExt(res, rej, false))
  }

  takeExt(fnVal, fnErr, needsCancelFn) {
    if (this._state == STATE_CLOSED) {
      fnVal(CLOSED)
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
    fnVal(item.val)
    item.fnVal && item.fnVal()

    if (this._state == STATE_CLOSING && this._buffer.length == 1) {
      let fns = this._buffer[0].fns
      for (let i = 0; i < fns.length; ++i) {
        fns[i]()
      }
      this._close()
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
        this._buffer.push({ fnVal: resolve, fnErr: undefined, consumes: false })
      })
    }
    return P_RESOLVED
  }

  tryClose() {
    if (this._state == STATE_CLOSED) {
      return true
    }
    if (this._buffer.length == 0) {
      this._close()
      return true
    }
    if (this._state == STATE_HAS_WAITING_CONSUMERS) {
      this._sendToAllWaitingConsumers(CLOSED)
      this._close()
      return true
    }
    return false
  }

  close() {
    if (this._state == STATE_CLOSED) {
      return P_RESOLVED
    }

    if (this._buffer.length == 0) {
      this._close()
      return P_RESOLVED
    }

    if (this._state == STATE_HAS_WAITING_CONSUMERS) {
      this._sendToAllWaitingConsumers(CLOSED)
      this._close()
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

    if (this._state == STATE_HAS_WAITING_CONSUMERS) {
      this._sendToAllWaitingConsumers(CLOSED)
      this._close()
      return P_RESOLVED
    }

    if (this._state == STATE_CLOSING) {
      let fns = this._buffer.pop().fns
      for (let i = 0; i < fns.length; ++i) {
        fns[i]()
      }
    }

    let err = new Error('channel closed')

    for (let i = 0; i < this._buffer.length; ++i) {
      let fnErr = this._buffer[i].fnErr
      fnErr && fnErr(err)
    }

    this._close()
  }

  _sendToWaitingConsumer(val) {
    let item = this._buffer.shift()
    while (item && !item.consumes) {
      item.fnVal && item.fnVal()
      item = this._buffer.shift()
    }
    if (!item) {
      this._state = STATE_NORMAL
      return false
    }
    item.fnVal(val)
    if (this._buffer.length == 0) {
      this._state = STATE_NORMAL
    }
    return true
  }

  _sendToAllWaitingConsumers(val) {
    for (let i = 0; i < this._buffer.length; ++i) {
      let item = this._buffer[i]
      item.fnVal && item.fnVal(item.consumes ? val : undefined)
    }
  }

  _close() {
    this._buffer.length = 0
    this._state = STATE_CLOSED
  }

  then(fnVal, fnErr) {
    return new Promise((resolve, reject) => {
      this.takeExt(
        (v) => {
          if (!fnVal) {
            return resolve(v)
          }
          try {
            resolve(fnVal(v))
          } catch (err) {
            if (!fnErr) {
              return reject(err)
            }
            try {
              resolve(fnErr(err))
            } catch (err2) {
              reject(err2)
            }
          }
        },
        (e) => {
          if (!fnErr) {
            return reject(e)
          }
          try {
            resolve(fnErr(e))
          } catch (err) {
            reject(err)
          }
        }
      )
    })
  }

  catch(fnErr) {
    return this.then(undefined, fnErr)
  }
}


Chan.CLOSED = CLOSED
Chan.FAILED = FAILED

Chan.prototype.CLOSED = CLOSED
Chan.prototype.FAILED = FAILED

Chan.prototype.delay = Chan.delay
Chan.prototype.timeout = Chan.timeout


function nop() {}


module.exports = Chan
export default Chan
