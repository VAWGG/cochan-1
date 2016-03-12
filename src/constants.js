export const P_RESOLVED = Promise.resolve()
export const P_RESOLVED_WITH_FALSE = Promise.resolve(false)
export const P_RESOLVED_WITH_TRUE = Promise.resolve(true)

export const OP_SEND = 0
export const OP_TAKE = 1

export class Marker {
  constructor(desc) { this._desc = `<${ desc }>` }
  toString() { return this._desc }
  inspect() { return this._desc }
}

export const CLOSED = new Marker('closed')
export const FAILED = new Marker('failed')

export const ISCHAN = new Marker('ischan')
