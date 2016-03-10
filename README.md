# cochan

Channel communication primitive, modelled after [golang channels]. Useful for
communication between concurrent activities, e.g. coroutines. Plays especially
well with generators or ES7 async/await, but doesn't depend on these language
features. Depends on `Promise` being available.

Supported features:

* [Blocking sends and receives](#basic-operations)
* [Buffering](#basic-operations)
* [Channel closing](#closing)
* Errors (readme TODO)
* [Synchronous (non-blocking) operations](#synchronous-operations)
* [Selection from a set of channels](#selection-from-a-set-of-channels)
* [Timeouts](#timeouts)
* [Merging multiple channels into one](#merging)
* [Making channels from Promises](#making-a-channel-from-a-promise)
* Making channels from [iterables, iterators, generators](#iterables-iterators-and-generators)
  and [async generators](#async-generators)
* [Piping Node.js streams into channels](#streams)

All supported operations respect and propagate backpressure, so, for example,
if you make a chan from a generator function, the function's iterator won't
be advanced until the last produced value is either consumed or buffered.

[golang channels]: https://tour.golang.org/concurrency/2


## Examples

You can find all examples inside the [_examples](_examples) directory.
Run them by cloning this repo, doing `npm install` and then
`./run-example _examples/path/to_example.js` (requires Node 4 or later).

There are three sub-directories inside `_examples`: `async-await`,
`generators-co` and `promises`. Examples with the same name implement
the same logic, and should give the same, or very similar, output.
So [_examples/async-await/1-buffer.js](_examples/async-await/1-buffer.js),
[_examples/generators-co/1-buffer.js](_examples/generators-co/1-buffer.js)
and [_examples/promises/1-buffer.js](_examples/promises/1-buffer.js) differ
only in the used language features.


## Usage

### Installation

To install from NPM:

```bash
npm i -S cochan
```

### Basic operations

To create a channel, use `new chan()`:

```js
var chan = require('cochan')
var ch = new chan()
```

The constructor accepts optional argument that sets the number of items that
this channel can buffer (defaults to `0`):

```js
var bufferedCh = new chan(3)
```

To send a value to a channel, use `send(value)`:

```js
ch.send('some value')
```

The `send()` function returns a `Promise` that gets resolved when the value
is either received by someone, or buffered inside the channel:

```js
var pReceived = ch.send('some value')
pReceived.then(() => console.log('the value is either buffered or received'))
```

To receive (take, consume) a value from a channel, use `take()`. It returns
a `Promise` that gets resolved with the received value, when one is available
in the channel:

```js
var pValue = ch.take()
pValue.then(value => console.log('received value:', value))
```

Only one consumer can receive a given value. This is the main semantic difference
between channels and Observable/FRP patterns, where the same value gets observed
by all current consumers.

> **Basic example**: [async-await](_examples/async-await/0-intro.js).<br>
> **Buffering example**: [async-await](_examples/async-await/1-buffer.js),
[generators-co](_examples/generators-co/1-buffer.js),
[plain-promises](_examples/plain-promises/1-buffer.js).

### Closing

To close a channel, use `close()`. It waits for consumption of all values that
are already sent to this channel, but not yet consumed, and then closes the
channel. Returns a `Promise` that gets resolved when the channel is completely
closed:

```js
var pClosed = ch.close()
pClosed.then(() => console.log('channel completely closed'))
```

After you call `close()`, but before the all items are consumed, the channel
is in "closing" state. You can check this by accessing `isClosingOrClosed`
and `isClosed` properties:

```js
ch.send('some value')
console.log(ch.isClosingOrClosed, ch.isClosed) // false, false

ch.close()
console.log(ch.isClosingOrClosed, ch.isClosed) // true, false

ch.take()
console.log(ch.isClosingOrClosed, ch.isClosed) // true, true
```

To close a channel immediately, discarding any non-consumed values that are
currently enqueued to the channel, use `closeNow()`:

```js
ch.closeNow()
```

When you close a channel, all consumers that are currently waiting for the next
value receive `chan.CLOSED`. All new consumers immediately receive the same
value upon attempt to `take()`. It is a good practice to always test for it:

```js
ch.take().then(value => {
  if (value == chan.CLOSED) {
    console.log('channel closed')
  } else {
    console.log('got new value:', value)
  }
})
```

For convenience, `chan.CLOSED` is also available via all chan instances:

```js
var ch = new chan()
console.log(ch.CLOSED === chan.CLOSED) // true
```

All attempts to send a value into a closed or closing channel will fail:

```js
ch.close()
ch.send('some value')
  .then(() => console.log('sent'))
  .catch(err => console.log(err)) // Error: attempt to send into a closed channel
```

When you use `closeNow()` function, all currently waiting sends will fail too:

```js
var ch = new chan()
ch.send('some value')
  .then(() => console.log('sent'))
  .catch(err => console.log(err))
ch.closeNow() // The send above fails with "Error: channel closed"
```

To test whether a channel can accept new values (i.e. not closed or closing), use
`canSend` property:

```js
var ch = new chan()
console.log(ch.canSend) // true

ch.close()
console.log(ch.canSend) // false
```

> **Basic example**: [async-await](_examples/async-await/0-intro.js).

### Synchronous operations

The `send()` function have one disadvantage: it always returns a `Promise`. It means that,
in order to ensure that the sent items are either consumed or buffered before sending the
next one, you always need to wait until the returned `Promise is resolved. And each `Promise`
gets resolved not earlier than on the next event loop tick, even if the channel can accept
the next item immediately (e.g. the channel is a buffered one, or there are consumers
waiting for a value on that channel).

The `take()` function is no different: even if there are multiple values already sitting
in the channel buffer, and/or there are multiple waiting publishers, the returned `Promise`
gets resolved only on the next tick. This is a property of all Promises that prevents them
from [releasing Zalgo](http://blog.izs.me/post/59142742143/designing-apis-for-asynchrony).

Sometimes you'd want to send/take as much values as possible at once, e.g. for performance
or synchronization reasons. That's where `sendSync(value)` and `takeSync()` come to the
rescue. They return `true` when synchorous sending/consuming succeeded, and `false` otherwise.
To obtain consumed value of successful `takeSync()`, use `value` property of the channel.

There are also `canSendSync` and `canTakeSync` properties that can be used to determine
whether `sendSync()` and `takeSync()` will succeed if you call them immediately after.

```js
// producer
while (items.length) {
  let item = items.shift()
  if (!ch.sendSync(item)) {
    await ch.send(item)
  }
}

// consumer
while (true) {
  let item = ch.takeSync() ? ch.value : await ch.take()
  if (item !== chan.CLOSED) {
    console.log('got item:', ch.value)
  } else {
    console.log('channel closed')
    break
  }
}
```

> There is no `canTake` property, as you can always take a value from a channel.
If the channel is closed, the taken value equals `chan.CLOSED`.

Another pair of related functions are `maybeCanSendSync()` and `maybeCanTakeSync()`.
They return a `Promise` that gets resolved when there is an opportunity to send/consume
a value synchronously (in which case the returned promise resolves with `true`), or
the channel is closed (in which case the promise resolves with `false`). Please note
that these functions do not _guarantee_ that you'll be able to actually send/consume
a value synchronously, but instead just provide a hint that you can try and succeed with
a high probability.

> **Example**: [async-await](_examples/async-await/3-batch.js).

### Selection from a set of channels

To consume the first value that appears in a set of channels, and find out which
channel that value came from, use `chan.select(...chans)`:

```js
chan.select(ch1, ch2).then(ch => {
  switch(ch) {
    case ch1: console.log('got value from ch1:', ch1.value); break
    case ch2: console.log('got value from ch2:', ch2.value); break
    case chan.CLOSED: console.log('both ch1 and ch2 are closed'); break
  }
})
```

When several channels have some value, the channel to take the value from
gets selected randomly.

The non-blocking counterpart of `chan.select(...chans)` is `chan.selectSync(...chans)`,
that either selects a value and returns the channel that the value came from, or returns
`chan.FAILED` if there are no readily available values/errors in any of the channels, or
returns `chan.CLOSED` if all non-timeout channels are closed.

> **Example**: [async-await](_examples/async-await/2-select.js).

### Timeouts

To add a configurable timeout to receive operation, use `chan.timeout(ms[, msg])` in
combination with `chan.select(...chans)`:

```js
var chTimeout = chan.timeout(5000) // to pass optional message, use second arg
chan.select(ch1, ch2, chTimeout).then(ch => {
  switch(ch) {
    case ch1: console.log('got value from ch1:', ch1.value); break
    case ch2: console.log('got value from ch2:', ch2.value); break
    case chan.CLOSED: console.log('both ch1 and ch2 are closed'); break
  }
}).catch(err => console.log(err)) // will go here on timeout
```

In fact, timeout channels are very special. Once the timeout is reached, they
start returning errors to all consumers, both current and future. This allows
you to define the single timeout channel for some long-running complex operation,
and then use that channel in various places in the code. That way, all running
operations will be interrupted at the time of a timeout.

> **Selection example**: [async-await](_examples/async-await/2-select.js).
> **chan.timeout example**: [async-await](_examples/async-await/6-special-chans.js).

### Merging

Sometimes you'll want to merge the output of multiple channels into one, and close
that resulting channel when all source channels has closed. The `chan.merge(...chans)`
helper function does exactly this, respecting backpressure generated by the output
channel.

This is somewhat similar to `select(...chans)`, but differs in that you are not
interested from which channel each output value came from, and you get a channel
instead of one-time receive operation.

```js
var chMerged = chan.merge(ch1, ch2, ch3)
```

The function supports optional last argument, in which wou can pass the following
options (default values are shown):

```js
var chMerged = chan.merge(ch1, ch2, ch3, {
  // if provided, this channel will be used as the output one, and returned from merge
  dst: undefined,
  // if dst is not provided, what buffer size to specify when creating output channel
  bufferSize: 0,
  // whether to close output channel when all input ones have closed
  closeDst: true
})
```

> **Example**: [async-await](_examples/async-await/5-merge.js).

### Making a channel from a Promise

To convert a Promise to a channel, use `chan.fromPromise(promise)`. The resulting
channel will produce exactly one value/error and then immediately close.

```js
var ch = chan.fromPromise(somePromise)
```

> **Example**: [async-await](_examples/async-await/6-special-chans.js).

### Iterables, iterators and generators

To make a channel from an iterable, use `chan.fromIterable(iterable[, opts])`:

```js
var ch1 = chan.fromIterable('abc') // will produce 'a', 'b', 'c', and then close
var ch2 = chan.fromIterable([1, 2, 3]) // will produce 1, 2, 3, and then close
```

This function obtains an iterator from an iterable, exhausts it, sending all produced
values into the resulting channel, and then closes the channel. The second optional
argument allows to pass additional options (defaults are shown):

```js
var ch = chan.fromIterable('abc', {
  chan: undefined, // use the passed channel instead of creating a new one
  closeChan: true, // close the resulting chan when the iterator is exhausted
  bufferSize: 0, // what buffer size to use when creating new channel (when opts.chan == undefined)
  sendRetval: false, // whether to send the last value of iterator (when state.done == true)
  async: false, // allow async iteration (see next section for this and next options)
  asyncRunner: thenableRunner,
  getAsyncRunnableType: thenableRunner.getRunnableType
})
```

If you want to make a channel from an already-obtained or custom iterator instead
of an iterable, use `chan.fromIterator(iter[, opts])`. It supports the same set of
options:

```js
var arrayIter = [ 1, 2, 3 ][ Symbol.iterator ]()
var arrayChan = chan.fromIterator(arrayIter)

var myIter = new MyCustomIter()
var myIterChan = chan.fromIterator(myIter, { sendRetval: true })
```

And, finally, you can also make a channel from a generator with
`chan.fromGenerator(gen[, opts])` function. Again, it supports the same
options as `chan.fromIterable()` and `chan.fromIterator()`:

```js
function* $generator(x) {
  yield 1
  yield x
  return 2
}

let genChan = chan.fromGenerator($generator(33), { sendRetval: true })
// produces 1, 33, 2, and then closes
```

The `sendRetval` option, in the case of generators, defines whether the value
produced with `return` (instead of `yield`) should be sent to the channel. Please
note that all functions have some return value: if you don't include explicit
`return` keyword, the implicit `return` of `undefined` will be inserted
automatically by the JavaScript VM.

> **Iterator example**: [async-await](_examples/async-await/7-iterator.js).
> **Generator example**: [async-await](_examples/async-await/8-generator.js).

### Async generators

Converting a generator into a channel is cool, but generators have a limitation:
they are synchronous. Some libraries, like `co`, allow to turn them into an
`async`-like functions, with `yield` meaning `await`:

```js
function* $asyncGenerator() {
  let result1 = yield somethingThatReturnsAPromise()
  let result2 = yield somethingThatReturnsAPromise()
  return result1 + result2
}

let promise = co($asyncGenerator())
promise.then(result => console.log('result:', result))
```

But then you lose the ability to use `yield` for sending a value to a channel,
because `yield` now means "await a Promise" and, moreover, you cannot pass
the resulting thing into `fromGenerator`, like this:

```js
let ch = chan.fromGenerator(co($asyncGenerator))
```

That's because `co($asyncGenerator)` returns a Promise, and `chan.fromGenerator()`
expects a generator. One possible solution is to forget about `chan.fromGenerator()`,
and use `chan.send()` to send values to the channel:

```js
function* $asyncGenerator(ch) {
  let result1 = yield smthThatReturnsPromise()
  yield ch.send(result1)
  let result2 = yield smthThatReturnsPromise()
  yield ch.send(result2)
}

let ch = new chan()
co($asyncGenerator(chan)).then(result => console.log(result))
```

In this case, you may as well use async/await instead of generators and `co`:

```js
async function asyncFn(ch) {
  let result1 = await smthThatReturnsPromise()
  await ch.send(result1)
  let result2 = await smthThatReturnsPromise()
  await ch.send(result2)
}

let ch = new chan()
asyncFn(chan).then(result => console.log(result))
```

Another option is to use `chan.fromGenerator()` with `opts.async` set to `true`:

```js
function* $asyncGenerator() {
  let result1 = yield smthThatReturnsPromise()
  yield result1
  let result2 = yield smthThatReturnsPromise()
  yield result2
}

let ch = chan.fromGenerator($asyncGenerator, { async: true })
```

It works as follows: if you `yield` a Promise, then this promise will be awaited
and the result returned back into the function, just like with the `await` keyword
in an async function. But if you `yield` a non-Promise value, it will be sent into
the resulting channel, and the execution of the function will resume after the
sent value is either buffered or consumed.

There are three async-related options that you can specify (among others) in the
second "options" argument of `chan.fromGenerator()`: `async`, `asyncRunner` and
`getAsyncRunnableType`. The first one, `async`, is a flag that turns the async
functionality on or off (off by default).

The remaining two options allow you to support async runnables other than Promises.
The `getAsyncRunnableType(value)` function is called each time a generator yields
some value, which is passed into the only argument of that function. If it returns
`undefined` or `null`, then the value is considered a usual value and gets sent
into a channel. Otherwise, the value is considered a runnable.

In that case, the `asyncRunner(value, type)` is called, with the runnable passed to
the first argument, and the type returned from `getAsyncRunnableType(value)` to
the second. If this function returns a non-Promise value or throws an error, the
returned value/error is sent back into the generator immediately. Otherwise, the
returned Promise is awaited, and the resulting value/error is sent into the generator
when that Promise settles.

> **Example**: [async-await](_examples/async-await/9-async-generator.js).

### Streams

To send all values from an object-mode Streams2/3 stream to a channel, respecting
backpressure generated by the channel, use `stream.pipe(chan)`. It works because
each normal channel is also a Streams3 writable stream:

```js
function streamToChan(stream) {
  var ch = new chan(5)
  ch.on('error', err => console.log(err))
  stream.pipe(ch)
  return ch
  // the shorter, but not so readable, version:
  // return stream.pipe(new chan(5)).on('error', err => console.log(err))
}
```

Note the error event handler attached to a channel. When you pipe some stream into
a channel, or use Streams-specific `chan::write()` or `chan::end()` functions, any
attempt to write into a closed channel will emit `error` event, which will crash
your app unless you handle it.

In the snippet above, this could happen if you manually closed the channel returned
from `streamToChan()`.

Also note that, when you pipe some stream into a channel, and that source stream
ends, it will end (close) the channel too. This is a standard Streams behavior.

> **Example**: [async-await](_examples/async-await/4-writable-stream.js).


## TODO

* Quick demo.
* API docs.
* Provide missing examples for `generators-co` and `plain-promises`.
* [Async iteration](https://github.com/tc39/proposal-async-iteration)?
