
exports.p = function p() {
  var totalArgs = arguments.length
  if (totalArgs && arguments[totalArgs - 1] instanceof Error) {
    var args = Array.apply(null, arguments)
    console.log.apply(console, args)
  } else {
    console.log.apply(console, arguments)
  }
}
