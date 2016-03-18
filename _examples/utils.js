
exports.p = function p(/* ...args */) {
  var totalArgs = arguments.length
  if (totalArgs && arguments[totalArgs - 1] instanceof Error) {
    var args = Array.apply(null, arguments)
    args[totalArgs - 1] = args[totalArgs - 1].stack
    console.log.apply(console, args)
  } else {
    console.log.apply(console, arguments)
  }
}

exports.sleep = function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

exports.getOneLinerBody = function getOneLinerBody(fn) {
  var lines = ('' + fn).split('\n')
  return lines.length == 1
    ? lines[0].replace(/^\([\w\d_]?\)\s*=>\s*|;\s*$/, '')
    : lines[1].replace(/^\s*(?:return)?\s*|;\s*$/g, '')
}
