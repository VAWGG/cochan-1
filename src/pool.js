const EMPTY = {}

export default class Pool {

  constructor({ makeNew, reset,
    prepare = undefined,
    initialCapacity = 10,
    maxCapacity = 100,
    name = 'pool'
  }){
    this._makeNew = makeNew
    this._reset = reset
    this._prepare = prepare
    this._items = []
    this._items.length = initialCapacity
    this._len = 0
    this._maxIndex = maxCapacity - 1
    this.name = name
    this.registeredMaxSize = 0
  }

  take() {
    if (this._len) {
      let i = --this._len
      let item = this._items[i]
      this._items[i] = EMPTY
      if (i > this.registeredMaxSize) {
        // console.log(`Pool<${this.name}> new max size: ${this.registeredMaxSize}`)
        this.registeredMaxSize = i
      }
      // console.log(`pool<${this.name}>.take(), len: ${i}`)
      if (this._prepare) {
        this._prepare(item)
      }
      return item
    } else {
      return this._makeNew()
    }
  }

  put(item) {
    this._reset(item)
    let index = this._len
    if (index < this._maxIndex) {
      this._items[ index ] = item
      ++this._len
      // console.log(`pool<${this.name}>.put(), len: ${this._len}`)
    } else {
      this._items[ index - 1 ] = item
    }
  }

  toString() {
    return `Pool<${this.name
      }>(len = ${this._len
      }, cap = ${this._maxIndex + 1
      }, max = ${this.registeredMaxSize})`
  }

  inspect() {
    return this.toString()
  }
}
