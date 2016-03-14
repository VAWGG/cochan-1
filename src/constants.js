export const P_RESOLVED = Promise.resolve()
export const P_RESOLVED_WITH_FALSE = Promise.resolve(false)
export const P_RESOLVED_WITH_TRUE = Promise.resolve(true)

export class Marker {
  constructor(desc) { this._desc = `<${ desc }>` }
  toString() { return this._desc }
  inspect() { return this._desc }
}

export const CLOSED = new Marker('closed')
export const FAILED = new Marker('failed')

export const ISCHAN = new Marker('ischan')

export const ERROR = { value: undefined }

export const OP_SEND = 1|0
export const OP_TAKE = 2|0

export const THENABLE_INVALID_USE_MSG = `chan.select() and chan.selectSync() expect that the ` +
  `results of chan::take() or chan::send() are passed to select()/selectSync() immediately, and ` +
  `used solely for this purpose; when using take()/send() with select() or selectSync(), don't ` +
  `use values returned from that invocations of take()/send() in any other places`
