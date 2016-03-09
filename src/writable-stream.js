import assert from 'power-assert'
import {nextTick} from './utils'
import {P_RESOLVED} from './constants'

class WritableStreamMixin {

  _initWritableStream() {
    this._needsDrain = false
  }

  write(chunk, encoding, cb) {
    if (this.isClosingOrClosed) {
      let err = new Error('attempt to write into a closed channel')
      nextTick(() => {
        cb && cb(err)
        this.emit('error', err)
      })
      return
    }
    // to match https://github.com/nodejs/node/blob/7764b6c/lib/_stream_writable.js#L198
    if ('function' == typeof encoding) {
      cb = encoding
      encoding = null
    }
    if (this.canSendSync) {
      this.sendSync(chunk)
      cb && nextTick(cb)
      return true
    }
    let ret = this._send(chunk, false, cb, cb)
    ret && ret.then(cb, cb)
    this._needsDrain = true
    return false
  }

  end(chunk, encoding, cb) {
    // to match https://github.com/nodejs/node/blob/7764b6c/lib/_stream_writable.js#L433
    if ('function' == typeof chunk) {
      cb = chunk
      chunk = null
      encoding = null
    } else if ('function' == typeof encoding) {
      cb = encoding
      encoding = null
    }
    if (chunk != undefined) {
      this.write(chunk, encoding)
    }
    if (cb) {
      let promise = this.close()
      if (promise === P_RESOLVED) {
        nextTick(cb)
      } else {
        promise.then(cb)
      }
    } else {
      this.close()
    }
  }

  _emitDrain() {
    assert(this._needsDrain)
    this._needsDrain = false
    this.emit('drain')
  }

  // these are noops:

  cork() {}
  uncork() {}
  setDefaultEncoding(encoding) {}
}


export const ChanWritableStreamMixin = {
  $proto: WritableStreamMixin.prototype
}
