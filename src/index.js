import {Chan} from './chan'

module.exports = Chan
export default Chan

import {BaseDelayChan, TimeoutChan, DelayChan} from './special-chans'
import {EventEmitterMixin} from './event-emitter'
import {ChanThenable} from './thenable'
import {select, selectSync} from './select'
import {ChanWritableStreamMixin} from './writable-stream'
import {mergeTo} from './merge'
import {ISCHAN, CLOSED, FAILED} from './constants'
import {mixin, describeArray} from './utils'


const MERGE_DEFAULT_OPTS = {
  dst: undefined,
  closeDst: true,
  bufferSize: 0
}

class ChanBase {

  static isChan(obj) {
    return obj && obj._ischan === ISCHAN
  }

  static timeout(ms, message) {
    return new TimeoutChan(ms, message)
  }

  static delay(ms, value) {
    return new DelayChan(ms, value)
  }

  static merge(/* ...chans */) {
    let chans = Array.apply(null, arguments)
    let opts = chans[ chans.length - 1 ]
    if (opts && opts.constructor === Object) {
      chans.pop()
    } else {
      opts = MERGE_DEFAULT_OPTS
    }
    let {dst} = opts; if (dst) {
      if (!Chan.isChan(dst)) {
        throw new TypeError('opts.dst must be a channel')
      }
    } else {
      dst = new Chan(opts.bufferSize)
    }
    return mergeTo(dst, chans, !!opts.closeDst)
  }

  take() {
    return this._thenable
  }

  toString() {
    let desc = this.name == undefined
      ? `${ this._constructorName }(${ describeArray(this._constructorArgsDesc) })`
      : `${ this._constructorName }<${ this.name }>(${ describeArray(this._constructorArgsDesc) })`
    return this.isClosingOrClosed
      ? (this.isClosed ? '[X]' : '[x]') + desc
      : desc
  }

  inspect() {
    return this.toString()
  }

  _initChanBase() {
    this._thenable = new ChanThenable(this)
  }

  get _constructorName() {
    return this.constructor.name
  }

  get _constructorArgsDesc() {
    return []
  }

  get _ischan() {
    return ISCHAN
  }
}

ChanBase.CLOSED = CLOSED
ChanBase.FAILED = FAILED
ChanBase.select = select
ChanBase.selectSync = selectSync

ChanBase.prototype.CLOSED = CLOSED
ChanBase.prototype.FAILED = FAILED

const ChanBaseMixin = {
  $static: ChanBase,
  $proto: ChanBase.prototype
}

mixin(Chan, ChanBaseMixin)
mixin(Chan, ChanWritableStreamMixin)
mixin(Chan, EventEmitterMixin)

mixin(BaseDelayChan, ChanBaseMixin)
mixin(BaseDelayChan, EventEmitterMixin)
