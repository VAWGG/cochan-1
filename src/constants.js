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

export const SEND_TYPE_VALUE = 0
export const SEND_TYPE_ERROR = 1
export const SEND_TYPE_INTENT = 2

export const THENABLE_MIXED_USE_MSG = `Select operations expect that the results of ` +
  `chan::take() or chan::send() are passed to select()/selectSync() immediately, and ` +
  `used solely for this purpose. When using take()/send() with select operations, don't ` +
  `use values returned from that invocations of take()/send() in any other places.`

export const THENABLE_MULTIPLE_USE_MSG = `Attempt to use the result of chan::take() or ` +
  `chan::send() in multiple select operations. This is not supported. Make a separate ` +
  `send/take call for each new select operation.`
