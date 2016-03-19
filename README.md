# cochan

[![NPM package version][npm-image]][npm-url]
[![Dependencies][deps-image]][deps-url]
[![NPM Downloads][downloads-image]][downloads-url]

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
* [Selection from a set of operations](#selection-from-a-set-of-operations)
* [Timeouts and signals](#timeouts-and-signals)
* [Merging multiple channels into one](#merging)
* [Making channels from Promises](#making-a-channel-from-a-promise)
* Making channels from [iterables, iterators, generators](#iterables-iterators-and-generators)
  and [async generators](#async-generators)
* [Piping Node.js streams into channels](#streams)
* [Unidirectional channels](#unidirectional-channels)

All supported operations respect and propagate backpressure, so, for example,
if you make a chan from a generator function, the function's iterator won't
be advanced until the last produced value is either consumed or buffered.

[golang channels]: https://tour.golang.org/concurrency/2


## Implementation status

Not ready for producution until 1.0 is released. API and semantics may change, and there
may be some bugs as the code is not covered by unit tests yet (TBD before 1.0).

However, I encourage you to play with examples and, maybe, try using the project in some
experimental or self-educational work. Please report any bugs you find and ask any
questions you've got in the [issues](https://github.com/skozin/cochan/issues).


## Quick demo

This example demonstrates how to distribute some I/O work, e.g. querying FS, processing images
using GraphicsMagick, uploading data to S3, etc., in a way that maintains the following nice
properties:

* No more than a configurable number of parallel operations are being processed at any given time.
* The process of requesting new work can be potentially asynchronous, like querying some remote
  service or message queue.
* The process of consuming work results can be potentially asynchronous too, e.g. writing to
  disk, db, or some remote service/queue.
* New work gets requested only when it can be processed. Optionally, new work can be requested
  in advance and buffered, with a reasonable upper bound, to minimize the amount of waiting for
  new work to process.
* Requesting and processing of new work stops until all current results are consumed. Optionally,
  results can be buffered, with a reasonable upper bound, to minimize the amount of waiting for
  current results consumption.
* The whole process can be cancelled at any time, without leaking resources.

This snippet shows ES7 async/await syntax, but it can be converted into ES6 with generators and
[co][co] (or [Bluebird]'s [`Promise.coroutine`]) rather trivially, and even to plain Promises,
albeit not so trivially.

[co]: https://github.com/tj/co
[`Promise.coroutine`]: http://bluebirdjs.com/docs/api/promise.coroutine.html
[Bluebird]: https://github.com/petkaantonov/bluebird

```js
async function generateWork(ctx) {
  let chNewWork = chan.fromPromise(ctx.requestWork())
  let chCanSend = null
  while (true) {
    switch (await chan.select( chNewWork, chCanSend, ctx.cancel )) {
      case chNewWork: // got new work
        chCanSend = chan.fromPromise(ctx.work.maybeCanSendSync())
      break
      case chCanSend: // probably can send work
        if (ctx.work.sendSync(chNewWork.value)) { // work sent, can request more
          chNewWork = chan.fromPromise(ctx.requestWork())
        } else {
          chCanSend = chan.fromPromise(ctx.work.maybeCanSendSync())
        }
      break
      case ctx.cancel:
        console.log(`work generator cancelled, reason: ${ctx.cancel.value}`)
        return
    }
  }
}

async function worker(ctx) {
  let chWork = ctx.work
  let chResult = null
  let opSendResult = null
  while (true) {
    switch (await chan.select( chWork, chResult, opSendResult, ctx.cancel )) {
      case chWork: // got new work
        chResult = chan.fromPromise(ctx.performWork(chWork.value))
        chWork = null // disable input chan until the work is done and sent
      break
      case chResult: // got work result
        opSendResult = ctx.results.send(chResult.value)
      break
      case ctx.results: // result sent, can query more work
        chWork = ctx.work
        opSendResult = null
      break
      case ctx.cancel: // cancelled
        console.log(`worker cancelled, reason: ${ctx.cancel.value}`)
        return
    }
  }
}

function run(opts) {
  let workBufferSize = Math.ceil(opts.maxParallel * opts.workBufferingRatio)
  let resultsBufferSize = Math.ceil(opts.maxParallel * opts.resultsBufferingRatio)
  let chResults = chan(resultsBufferSize)
  let ctx = {
    requestWork: opts.requestWork,
    performWork: opts.performWork,
    work: chan(workBufferSize),
    results: chResults.sendOnly,
    cancel: chan.signal()
  }
  for (let i = 0; i < opts.maxParallel; ++i) {
    worker(i, ctx).catch(opts.onError)
  }
  generateWork(ctx).catch(opts.onError)
  return {
    results: chResults.takeOnly,
    cancel: (reason) => {
      ctx.cancel.trigger(reason)
      chResults.close()
    }
  }
}

let processor = run({
  requestWork: requestSomeWork, // function that returns a Promise of new work
  performWork: performSomeWork, // function that returns a Promise of result for a given work
  maxParallel: 4,
  workBufferingRatio: 1.5,
  resultsBufferingRatio: 0,
  onError: err => console.log(err.stack)
})

// processor.results is a channel with work results
// call processor.cancel(reason) to cancel the whole process any time
```

Please see the [complete working example](_examples/async-await/00-demo.js).


## Examples

You can find all examples inside the [_examples](_examples) directory. Run them by cloning
this repo, doing `npm install` and then `./run-example _examples/path/to_example.js`
(requires Node 4 or later). The `run-example` script configures Node to transpile ES6/7
syntax used in examples to a subset of ES6 suported in Node.js v4 (using Babel).

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

To create a channel, use `chan()` function:

```js
var chan = require('cochan')
var ch = chan()
```

The function accepts optional argument that sets the number of items that
this channel can buffer (defaults to `0`):

```js
var bufferedCh = chan(3)
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

> **Examples**:<br>
> Basic operations: [async-await](_examples/async-await/01-basic-operations.js).<br>
> Buffering: [async-await](_examples/async-await/02-buffering.js),
  [generators-co](_examples/generators-co/02-buffering.js),
  [plain-promises](_examples/plain-promises/02-buffering.js).

### Closing

To close a channel, use `close()`. It waits for consumption of all values that
are already sent to this channel, but not yet consumed, and then closes the
channel. Returns a `Promise` that gets resolved when the channel is completely
closed:

```js
var pClosed = ch.close()
pClosed.then(() => console.log('channel completely closed'))
```

After you call `close()`, but before the all items are consumed, the channel is
in "closing" state. You can check this by accessing `isActive` and `isClosed`
properties; `isActive` means "is not closing or closed":

```js
ch.send('some value')
console.log(ch.isActive, ch.isClosed) // true, false

ch.close()
console.log(ch.isActive, ch.isClosed) // false, false

ch.take()
console.log(ch.isActive, ch.isClosed) // false, true
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
var ch = chan()
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
var ch = chan()
ch.send('some value')
  .then(() => console.log('sent'))
  .catch(err => console.log(err))
ch.closeNow() // The send above fails with "Error: channel closed"
```

To test whether a channel can accept new values (i.e. not closed or closing), use
`canSend` property:

```js
var ch = chan()
console.log(ch.canSend) // true

ch.close()
console.log(ch.canSend) // false
```

> **Examples**:<br>
> Basic operations: [async-await](_examples/async-await/01-basic-operations.js).

### Synchronous operations

The `send()` function has one disadvantage: it always returns a `Promise`. It means that,
in order to ensure that the sent items are either consumed or buffered before sending the
next one, you always need to wait until the returned `Promise` is resolved. And each `Promise`
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

Another pair of related functions are `maybeCanSendSync()` and `maybeCanTakeSync()`.
They return a `Promise` that gets resolved when there is an opportunity to send/consume
a value synchronously (in which case the returned promise resolves with `true`), or
the channel is closed (in which case the promise resolves with `false`). Please note
that these functions do not _guarantee_ that you'll be able to actually send/consume
a value synchronously, but instead just provide a hint that you can try and succeed with
a high probability.

> **Examples**:<br>
> Batching: [async-await](_examples/async-await/08-batch.js).

### Selection from a set of operations

The `chan.select(...ops)` function allows to perform the first available send/take operation
from the provided set, and discard all others. Besides this, it tells you which channel that
operation was performed on.

For example, to consume the first value that appears in a set of channels, and find out
which channel that value came from, you can do this:

```js
chan.select(ch1.take(), ch2.take()).then(ch => {
  switch(ch) {
    case ch1: console.log('received a value from ch1:', ch1.value); break
    case ch2: console.log('received a value from ch2:', ch2.value); break
    case chan.CLOSED: console.log('both ch1 and ch2 are closed'); break
  }
})
```

Send a value to channel `a`, or receive a value from channel `b`, whichever comes first:

```js
chan.select(a.send('some value'), b.take()).then(ch => {
  switch(ch) {
    case a: console.log('sent a value to a'); break
    case b: console.log('received a value from b:', ch2.value); break
    case chan.CLOSED: console.log('nothing was done: both a and b have closed'); break
  }
})
```

> When several operations from the provided set can be performed simultaneously, the
> operation to perform gets selected randomly.

As a shortcut, for receive operations you can skip the `.take()` call and just pass
the channel:

```js
chan.select(ch1, ch2).then(ch => {
  switch(ch) {
    case ch1: console.log('received a value from ch1:', ch1.value); break
    case ch2: console.log('received a value from ch2:', ch2.value); break
    case chan.CLOSED: console.log('both ch1 and ch2 are closed'); break
  }
})
```

The non-blocking counterpart of `chan.select(...ops)` is `chan.selectSync(...ops)`. It either
synchronously performs an operation and returns the channel that the operation was performed
on, or returns `null` if there are no operations in the provided set that can be performed
synchronously, or returns `chan.CLOSED` if all non-timeout channels are closed.

Note the difference from the [golang select operation], where receive operations proceed as
soon the corresponding channel has closed. In contrast, `chan.select()` doesn't treat receive
operations on closed channels as able to proceed, despite the fact that such operations
outside of `chan.take()` can proceed immediately, yielding `chan.CLOSED`. Instead,
`chan.select()`, if needed, blocks until some other operation become available. Only when
all passed channels are closed, it returns `chan.CLOSED`. This behavior may change in future,
but for now it seems to be more useful than the golang's one.

[golang select operation]: https://golang.org/ref/spec#Select_statements

> **Examples:**<br>
> Selection from multiple take operations:
  [async-await](_examples/async-await/03-select-take.js).<br>
> Selection from multiple take and send operations:
  [async-await](_examples/async-await/04-select-take-send.js).<br>
> Batched selection: [async-await](_examples/async-await/09-batch-select.js).<br>
> Cancellation using select: [async-await](_examples/async-await/06-cancellation.js).<br>
> Timeout using select: [async-await](_examples/async-await/07-timeout.js).<br>
> Send/receive with piped channels: [async-await](_examples/async-await/15-select-loop.js).

### Timeouts and signals

To create a timeout channel, use `chan.timeout(ms[, msg])`. The created channel can be used
in combination with [`chan.select(...ops)`] to add a configurable timeout to some send/receive
operation or a set of operations:

[`chan.select(...ops)`]: #selection-from-a-set-of-operations

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

If none of the other operations inside `select()` statement are able to complete before the
timeout, the Promise returned from `select()` call gets rejected with a timeout error.
Similarly, the `selectSync()` call will throw if one of its operations is a take from a timeout
channel which timeout has already passed.

In fact, timeout channels are very special. Once the timeout is reached, they return an error
to all current consumers, and keep returning errors to any future consumers. This allows you to
define the single timeout channel for some long-running complex operation, and then use that
channel in various places in the code. That way, all running operations will be interrupted at
the time of a timeout.

Another special kind of channels is signal channels. They are very similar to timeout channels,
but return some value instead of an error, and get triggered not after some delay, but manually
using the `trigger(value)` function. This allows you to easily make channels that communicate
some message to all their consumers, without the need to know the number of consumers. For
example, they can be used to notify all workers that they need to cancel:

```js
let chCancel = chan.signal()

for (let i = 0; i < numWorkers; ++i) {
  worker(chWork, chResults, chCancel).catch(handleWorkerError)
}

function cancelAllWorkers() {
  chCancel.trigger()
}

function worker(chWork, chResults, chCancel) {
  while (true) {
    switch(await chan.select( chCancel /**, some other chans and operations **/ )) {
      case chCancel:
        console.log('cancelled, reason:', chCancel.value)
        return
      // other cases...
    }
  }
}
```

> **Examples:**<br>
> chan.timeout() and chan.signal(): [async-await](_examples/async-await/05-special-chans.js).<br>
> Select + timeout: [async-await](_examples/async-await/07-timeout.js).<br>
> Select + timeout (another example): [async-await](_examples/async-await/15-select-loop.js).<br>
> Select with cancellation: [async-await](_examples/async-await/06-cancellation.js).


### Merging

Sometimes you'll want to merge the output of multiple channels into one, and close
that resulting channel when all source channels have closed. The `chan.merge(...chans)`
helper function does exactly this, respecting backpressure generated by the output
channel.

This is somewhat similar to `chan.select(...chansOrTakeOps)`, but differs in that
you are not interested from which channel each output value came from, and you get
a channel instead of performing one-time receive operation.

```js
var chMerged = chan.merge(ch1, ch2, ch3)
```

The function supports optional last argument, in which wou can pass the following
options (default values are shown):

```js
var chMerged = chan.merge(ch1, ch2, ch3, {
  // if provided, this channel will be used as the output one, and returned from the merge call
  output: undefined,
  // if output is not provided, what buffer size to specify when creating output channel
  bufferSize: 0,
  // whether to close output channel when all input ones have closed
  closeOutput: true
})
```

> **Examples:**<br>
> Merging channels: [async-await](_examples/async-await/11-merge.js).

### Making a channel from a Promise

To convert a Promise to a channel, use `chan.fromPromise(promise)`. The resulting
channel will produce exactly one value/error and then immediately close.

```js
var ch = chan.fromPromise(somePromise)
```

> **Examples:**<br>
> chan.fromPromise(): [async-await](_examples/async-await/05-special-chans.js#L17).

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
  output: undefined, // use the passed channel as output, instead of creating a new one
  closeOutput: true, // close the output channel when the iterator is exhausted
  bufferSize: 0, // what buffer size to use when creating output channel
  sendRetval: false, // whether to send the last value of iterator (when state.done == true)
  async: false // allow async iteration (see next section for details)
})
```

If you want to make a channel from an already-obtained or custom iterator (instead
of an iterable), use `chan.fromIterator(iter[, opts])`. It supports the same set of
options:

```js
var arrayIter = [ 1, 2, 3 ][ Symbol.iterator ]()
var arrayChan = chan.fromIterator(arrayIter)

var myIter = new MyCustomIter()
var myIterChan = chan.fromIterator(myIter, { sendRetval: true })
```

And, finally, you can also make a channel from a generator with `chan.fromGenerator(gen[, opts])`
function. Again, it supports the same options as `chan.fromIterable()` and `chan.fromIterator()`:

```js
function* $generator(x) {
  yield 1
  yield x
  return 2
}

let genChan = chan.fromGenerator($generator(33), { sendRetval: true })
// produces 1, 33, 2, and then closes
```

The `sendRetval` option, in the case of generators, defines whether the value produced by
`return` (instead of `yield`) statement should be sent to the channel. Please note that
all functions end with a return statement, even if you don't specify it explicitly, in which
case an implicit `return undefined` will be appended automatically by the JavaScript VM.

> **Examples**:<br>
> Iterator: [async-await](_examples/async-await/12-iterator.js).<br>
> Generator: [async-await](_examples/async-await/13-generator.js).

### Async generators

Converting a generator into a channel is cool, but generators have one limitation: they are
synchronous. This means that you can't get some Promise, wait until it resolves, and only
then send the result into a channel.

Some libraries, like `co`, allow to turn generators into an `async`-like functions, with
`yield` meaning the same as `await`:

```js
function* $asyncGenerator() {
  let result1 = yield promiseReturningX()
  let result2 = yield promiseReturningY()
  return result1 + result2
}

let promise = co($asyncGenerator())
promise.then(result => console.log('result:', result))
```

But then you lose the ability to use `yield` for sending a value into a channel,
because `yield` now means "await a Promise" and, moreover, you cannot pass the
resulting thing into `chan.fromGenerator()`, like this:

```js
let ch = chan.fromGenerator(co($asyncGenerator))
```

That's because `co($asyncGenerator)` returns a `Promise`, and `chan.fromGenerator()`
expects a generator. One possible solution is to forget about `chan.fromGenerator()`,
and just use `chan.send()` to send values into the channel:

```js
function* $asyncGenerator(ch) {
  let result1 = yield promiseReturningX()
  yield ch.send(result1)
  let result2 = yield promiseReturningY()
  yield ch.send(result2)
}

let ch = chan()
co($asyncGenerator(chan)).then(result => console.log(result))
```

But now you may as well use async/await instead of generators and `co`:

```js
async function asyncFn(ch) {
  let result1 = await smthThatReturnsPromise()
  await ch.send(result1)
  let result2 = await smthThatReturnsPromise()
  await ch.send(result2)
}

let ch = chan()
asyncFn(chan).then(result => console.log(result))
```

But there is another option: use `chan.fromGenerator()` with `async` option set to `true`.

```js
function* $asyncGenerator() {
  let result1 = yield smthThatReturnsPromise() // behaves like await
  yield result1 // behaves like send()
  let result2 = yield smthThatReturnsPromise() // behaves like await
  yield result2 // behaves like send()
}

let ch = chan.fromGenerator($asyncGenerator, { async: true })
```

It works as follows: when you `yield` a `Promise`, then this promise is awaited and the result
returned back into the function, just like with the `await` keyword in an `async` function.
But if you `yield` a non-`Promise` value, it will be sent into the resulting channel, and the
execution of the function will be resumed after the sent value is either buffered or consumed.

Instead of `true`, you can pass to `opts.async` an object of the following shape:

```js
{
  getRunnableType: (value: any) -> (null | any),
  runner: (value: any, type: any) -> (Promise | any)
}
```

The `getRunnableType(value)` function is called each time a generator yields some value,
which is passed into the only argument of that function. If it returns `undefined` or
`null`, then the `value` is considered a usual value and gets sent into a channel.
Otherwise, the `value` is considered a runnable.

In that case, the `runner(value, type)` function is called, with the runnable passed to
the first argument, and the type returned from `getRunnableType(value)` to the second,
and its return value is inspected. If this function returns a non-Promise value or throws
an error, the returned value or error is sent back into the generator immediately, i.e.
the value is returned (and the error is thrown) from the `yield` operation. Otherwise,
the returned Promise is awaited on, and the resulting value/error is sent back into the
generator when that Promise settles.

The `async` option is also supported by `chan.fromIterator()` and `chan.fromIterable()`
functions.

When you pass `async: true`, it gets replaced with the default async options described above,
i.e. `runner` and `getRunnableType` that are designed to run Promises. You can change these
defaults with `chan.setAsyncDefaults(asyncOpts)` function:

```js
chan.setAsyncDefaults({
  getRunnableType: myGetRunnableType,
  runner: myRunner
})
```

This setting will affect all future calls of `chan.fromIterable()`, `chan.fromIterator()`
and `chan.fromGenerator()` in which `opts.async` is set to `true`.

> **Examples**:<br>
> Async generator: [async-await](_examples/async-await/14-async-generator.js).

### Streams

To send all values from an object-mode Streams2/3 stream to a channel, respecting
backpressure generated by the channel, use `stream.pipe(chan)`. It works because
each normal channel is also a Streams3 writable stream:

```js
function streamToChan(stream) {
  var ch = chan(5)
  ch.on('error', err => console.log(err))
  stream.pipe(ch)
  return ch
  // the shorter, but not so readable, version:
  // return stream.pipe(chan(5)).on('error', err => console.log(err))
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

> **Examples**:<br>
> Piping a stream into a chan: [async-await](_examples/async-await/10-writable-stream.js).

### Unidirectional channels

Sometimes, you know that some code that you're giong to pass a channel to should only consume
from that channel, or only produce into it. In such cases, for enforcing correctness you can
convert the channel into a take-only or send-only one. This is done with `takeOnly` and
`sendOnly` properties:

```js
let ch = chan()

consumeFrom(ch.takeOnly)
produceInto(ch.sendOnly)
```

These properties don't modify the original channel, but instead return a proxy that
delegates all allowed operations to the original channel, and throw on any attempt
to perform a prohibited operation.

Take-only channels allow consuming from a channel, both synchronously and asynchronously.
Send-only channels allow producing into a channel (sync & async), and closing a channel.

> **Examples**:<br>
> Unidirectional channels: [async-await](_examples/async-await/16-unidirectional.js).<br>
> Demo: [async-await](_examples/async-await/00-demo.js).


## Test coverage (WIP)

```
---------------------|----------|----------|----------|----------|
File                 |  % Stmts | % Branch |  % Funcs |  % Lines |
---------------------|----------|----------|----------|----------|
 src/                |    22.42 |     9.55 |    20.41 |    22.62 |
  chan.js            |    27.39 |       20 |    18.75 |    27.78 |
  constants.js       |    86.67 |      100 |      100 |    85.71 |
  event-emitter.js   |    14.94 |        0 |        0 |    16.88 |
  index.js           |    45.87 |     8.33 |       15 |    45.28 |
  iterator.js        |    13.25 |        0 |        0 |    13.58 |
  merge.js           |     9.57 |        0 |        0 |     9.82 |
  pool.js            |    37.93 |       25 |      100 |    37.93 |
  pools.js           |       50 |      100 |        0 |       50 |
  schedule.js        |    52.94 |       50 |       50 |    53.85 |
  select.js          |     7.69 |        0 |        0 |      7.2 |
  special-chans.js   |        7 |        0 |    33.33 |     7.22 |
  thenable.js        |    45.68 |    26.09 |       75 |    45.68 |
  unidirectional.js  |      2.9 |        0 |       40 |      2.9 |
  utils.js           |    54.41 |    19.23 |    16.67 |    55.22 |
  writable-stream.js |     5.88 |        0 |       50 |     5.88 |
---------------------|----------|----------|----------|----------|
All files            |    22.42 |     9.55 |    20.41 |    22.62 |
---------------------|----------|----------|----------|----------|
```


## TODO

* API docs.
* Cover with tests.
* Provide missing examples for `generators-co` and `plain-promises`.
* Support [async iteration](https://github.com/tc39/proposal-async-iteration)?


[npm-image]: https://img.shields.io/npm/v/cochan.svg?style=flat-square
[npm-url]: https://npmjs.org/package/cochan
[downloads-image]: http://img.shields.io/npm/dm/cochan.svg?style=flat-square
[downloads-url]: https://npmjs.org/package/cochan
[deps-image]: https://img.shields.io/david/skozin/cochan.svg?style=flat-square
[deps-url]: https://david-dm.org/skozin/cochan/master
