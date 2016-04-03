import {mixin} from './utils'

const EventEmitterMixin = {

  emit(event /* ...args */) {
    let listeners = this._listeners ? this._listeners[event] : undefined
    if (listeners && listeners.length) {
      switch (arguments.length) {
        case 1: emitNone(listeners, this); break
        case 2: emitOne(listeners, this, arguments[1]); break
        case 3: emitTwo(listeners, this, arguments[1], arguments[2]); break
        default: emitMany(listeners, this, Array.apply(null, arguments)); break
      }
      return true
    }
    if (event == 'error') {
      let err = arguments[1]
      if (err == undefined) {
        err = new Error('uncaught, unspecified error event')
      } else if (!(err instanceof Error)) {
        err = new Error('uncaught error event: ' + err)
      }
      throw err
    }
    return false
  }
  
  , addListener(event, fn) {
    if (this._listeners) {
      let listeners = this._listeners[event]
      if (!listeners) {
        this._listeners[event] = [fn]
      } else {
        listeners.push(fn)
      }
    } else {
      this._listeners = {
        [event]: [fn]
      }
    }
    return this
  }

  , addListenerOnce(event, fn) {
    this.addListener(event, removeAndFire)
    function removeAndFire() {
      this.removeListener(event, removeAndFire)
      fn.apply(this, arguments)
    }
    return this
  }

  , removeListener(event, fn) {
    let listeners = this._listeners ? this._listeners[event] : undefined
    if (listeners) {
      let index = listeners.indexOf(fn)
      if (index >= 0) {
        listeners.splice(index, 1)
      }
    }
    return this
  }

  , removeAllListeners(event) {
    if (arguments.length) {
      let listeners = this._listeners ? this._listeners[event] : undefined
      if (listeners && listeners.length) {
        this._listeners[event] = []
      }
    } else if (this._listeners) {
      this._listeners = {}
    }
    return this
  }

  , listenerCount(event) {
    let listeners = this._listeners ? this._listeners[event] : undefined
    return listeners ? listeners.length : 0
  }

  , listeners(event) {
    let listeners = this._listeners ? this._listeners[event] : undefined
    return listeners ? listeners.splice() : []
  }
}

EventEmitterMixin.on = EventEmitterMixin.addListener
EventEmitterMixin.once = EventEmitterMixin.addListenerOnce

function emitNone(listeners, emitter) {
  let len = listeners.length; listeners = arrayClone(listeners, len)
  for (let i = 0; i < len; ++i) {
    listeners[i].call(emitter)
  }
}

function emitOne(listeners, emitter, arg) {
  let len = listeners.length; listeners = arrayClone(listeners, len)
  for (let i = 0; i < len; ++i) {
    listeners[i].call(emitter, arg)
  }
}

function emitTwo(listeners, emitter, arg1, arg2) {
  let len = listeners.length; listeners = arrayClone(listeners, len)
  for (let i = 0; i < len; ++i) {
    listeners[i].call(emitter, arg1, arg2)
  }
}

function emitMany(listeners, emitter, args) {
  let len = listeners.length; listeners = arrayClone(listeners, len)
  for (let i = 0; i < len; ++i) {
    listeners[i].apply(emitter, args)
  }
}

function arrayClone(arr, i) {
  if (i == 1) {
    return [arr[0]]
  }
  if (i < 32) {
    return Array.apply(null, arr)
  }
  let copy = new Array(i)
  while (--i) copy[i] = arr[i]
  copy[i] = arr[i]
  return copy
}


function EventEmitter() {
  this._listeners = {}
}

mixin(EventEmitter, EventEmitterMixin)
EventEmitter.Mixin = EventEmitterMixin

export default EventEmitter
export {EventEmitterMixin, EventEmitter}
