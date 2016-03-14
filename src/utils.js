
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


export function isIterator(obj) {
  return obj && 'function' === typeof obj.next
}


export function isGenerator(obj) {
  return obj && 'function' === typeof obj.next && 'function' === typeof obj.throw
}

// From here: https://github.com/tj/co/blob/b3ad55a/index.js#L215
//
export function isGeneratorFunction(obj) {
  if (!obj) return false
  let {constructor} = obj; return constructor && (
    'GeneratorFunction' === constructor.name ||
    'GeneratorFunction' === constructor.displayName ||
    isGenerator(constructor.prototype))
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


export function defaultTo(def, value) {
  return value === undefined ? def : value
}


export function extend(dst, src) {
  if (src) {
    let keys = Object.keys(src)
    for (let i = 0; i < keys.length; ++i) {
      let key = keys[i]
      dst[key] = src[key]
    }
  }
  return dst
}


export function nop() {}
