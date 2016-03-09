export let nextTick;

if ('undefined' != typeof process && process.nextTick) {
  nextTick = fn => process.nextTick(fn)
} else if ('undefined' != typeof setImmediate) {
  nextTick = setImmediate
} else {
  nextTick = fn => setTimeout(fn, 0)
}


export function mixin(Cls, protoMixin, staticMixin) {
  if (arguments.length == 2) {
    let keys = Object.keys(protoMixin)
    switch (keys.length) {
      case 1:
        if (keys[0] == '$proto') {
          protoMixin = protoMixin.$proto
        } else if (keys[0] == '$static') {
          staticMixin = protoMixin.$static
          protoMixin = undefined
        }
      break
      case 2:
        if (keys.indexOf('$proto') >= 0 && keys.indexOf('$static') >= 0) {
          staticMixin = protoMixin.$static
          protoMixin = protoMixin.$proto
        }
      break
    }
  }
  if (protoMixin) {
    if (Cls.prototype) {
      _mixin(Cls.prototype, protoMixin)
    } else {
      throw new Error('attempt to mixin prototype members into a non-Function: ' + Cls)
    }
  }
  if (staticMixin) {
    _mixin(Cls, staticMixin)
  }
  return Cls
}


function _mixin(dst, src) {
  let srcPropNames = Object.getOwnPropertyNames(src)
  let dstPropNames = Object.getOwnPropertyNames(dst)
  let descriptors = {}
  for (let i = 0; i < srcPropNames.length; ++i) {
    let propName = srcPropNames[i]
    if (dstPropNames.indexOf(propName) == -1) {
      let desc = Object.getOwnPropertyDescriptor(src, propName)
      desc.enumerable = false
      desc.configurable = true
      if ('value' in desc) {
        desc.writable = true
      }
      descriptors[propName] = desc
    }
  }
  Object.defineProperties(dst, descriptors)
  return dst
}


export function repeat(x, n) {
  return new Array(n).fill(x)
}


export function isThenable(obj) {
  return obj && 'function' === typeof obj.then
}


export function describeArray(arr) {
  return arr && arr.length
    ? arr.map(describeValue).join(', ')
    : ''
}


export function describeValue(v) {
  switch (typeof v) {
    case 'string': return `"${v}"`
    case 'function': return `${ v.name || '' }(){ ... }`
    default: return '' + v
  }
}


export function nop() {}
