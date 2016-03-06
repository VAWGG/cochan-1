import {ISCHAN, CLOSED, FAILED} from './constants'
import Chan$Thenable from './thenable'

class ChanBase {

  static isChan(obj) {
    return obj && obj._ischan === ISCHAN
  }

  _initChanBase() {
    this._thenable = new Chan$Thenable(this)
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

ChanBase.prototype.CLOSED = CLOSED
ChanBase.prototype.FAILED = FAILED


function describeArray(arr) {
  return arr && arr.length
    ? arr.map(describeValue).join(', ')
    : ''
}

function describeValue(v) {
  switch (typeof v) {
    case 'string': return `"${v}"`
    case 'function': return `${ v.name || '' }(){ ... }`
    default: return '' + v
  }
}


export const Chan$BaseMixin = {
  $static: ChanBase,
  $proto: ChanBase.prototype
}
