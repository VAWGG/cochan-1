import assert from 'power-assert'
import schedule from './schedule'
import {P_RESOLVED, SEND_TYPE_VALUE} from './constants'

// TODO: test unpiping, see:
//
// https://nodejs.org/api/stream.html#stream_event_unpipe
// https://github.com/nodejs/node/blob/master/lib/_stream_readable.js#L615
//
class WritableStreamMixin {

  write(chunk, encoding, cb) {
    if (!this.isActive) {
      let err = new Error('attempt to write into a closed channel')
      schedule.microtask(() => {
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
    if (this._sendSync(chunk, SEND_TYPE_VALUE)) {
      cb && schedule.microtask(cb)
      return true
    }
    this._needsDrain = true
    this._send(chunk, SEND_TYPE_VALUE, cb, cb, false)
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
        schedule.microtask(cb)
      } else {
        promise.then(cb)
      }
    } else {
      this.close()
    }
  }

  // these are noops:

  cork() {}
  uncork() {}
  setDefaultEncoding(encoding) {}
}


export const ChanWritableStreamMixin = {
  $proto: WritableStreamMixin.prototype
}
