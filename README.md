# cochan

Channel communication primitive, modelled after [golang channels]. Useful for
communication between concurrent activities, e.g. coroutines. Plays especially
well with generators or ES7 async/await, but doesn't depend on these language
features. Depends on `Promise` being available.

Supports buffering, selection and merging from multiple channels, non-blocking
operations, errors, channel closing and interoperation with Node.js streams.

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
only in used language features.


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

To send a value to a channel, use `send()`:

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

Basic example: [async-await](_examples/async-await/0-intro.js).<br>
Buffering example: [async-await](_examples/async-await/1-buffer.js),
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

Basic example: [async-await](_examples/async-await/0-intro.js).

### Synchronous operations

The `send()` function have one disadvantage: it always returns a `Promise. This means that,`
in order to ensure that the sent items are either consumed or buffered before sending the
next one, you always need to wait until the returned `Promise is resolved. And each `Promise`
gets resolved not earlier than on the next event loop tick, even if the channel can accept
the next item immediately (e.g. the channel is a buffered one, or there are waiting
consumers).

The `take()` function is no different: even if there are multiple values already sitting
in the channel buffer, and/or there are multiple waiting publishers, the returned `Promise`
gets resolved only on the next tick. This is a property of all Promises that prevents them
from [releasing Zalgo](http://blog.izs.me/post/59142742143/designing-apis-for-asynchrony).

Sometimes you'd want to send/take as much values as possible, e.g. for performance or synchronization reasons. That's where `sendSync()` and `takeSync()` come to the rescue.
They return `true` when synchorous sending/consuming succeeded, and `false` otherwise.
To obtain consumed value of successful `takeSync()`, use `value` property of the channel.

There are also `canSendSync` and `canTakeSync` properties that you can use to determine
whether `sendSync()` and `takeSync()` will succeed if you call them immediately after,
which is sometimes useful.

> There is no `canTake` property, as you can always take a value from a channel.
If the channel is closed, the taken value equals `chan.CLOSED`.

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

Example: [async-await](_examples/async-await/3-batch.js).

### Selection from a set of channels

To consume the first value that appears in a set of channels, and find out which
channel that value came from, use `chan.select()`:

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

The non-blocking counterpart of `chan.select()` is `chan.selectSync()`, that
either selects a value and returns the channel that the value came from, or
returns `chan.FAILED` if there are no readily available values/errors in any
of the channels, or returns `chan.CLOSED` if all non-timeout channels are
closed.

Example: [async-await](_examples/async-await/2-select.js).

### Timeouts

To add a configurable timeout to receive operation, use `chan.timeout()` in
combination with `chan.select()`:

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

Example: [async-await](_examples/async-await/2-select.js).

### Merging

Sometimes you'll want to merge the output of multiple channels into one, and close
that resulting channel when all source channels has closed. The `chan.merge()` helper
function does exactly this, respecting backpressure generated by the output channel.

This is somewhat similar to `select()`, but differs in that you are not interested
from which channel each output value came from, and you get a channel instead of
one-time receive operation.

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

Example: [async-await](_examples/async-await/5-merge.js).

### Streams

To send all values from an object-mode Streams2/3 stream to a channel, respecting
backpressure generated by the channel, use `stream.pipe(chan)`. It works because
each normal channel is also a Streams3 writable stream:

```js
function streamToChan(stream) {
  let chan = new chan(5)
  chan.on('error', err => console.log(err))
  stream.pipe(chan)
  return chan
  // the shorter, but not so readable, version:
  // return stream.pipe(new chan(5)).on('error', err => console.log(err))
}
```

Note the error event handler attached to a channel. When you pipe some stream into
a channel, or use Streams-specific `chan::write()` or `chan::end()` functions, any
attempt to write into a closed channel will emit `error` event, which will crash
your app unless you handle it.

In the snippet above, this could happen if you manually close the channel returned
from `streamToChan()`.

Also note that, when you pipe some stream into a channel, and that source stream
ends, it will end (close) the channel too. This is a standard Streams behavior.

Example: [async-await](_examples/async-await/4-writable-stream.js).


## TODO

* Quick demo.
* API docs.
* Provide missing examples for `generators-co` and `plain-promises`.
* [Async iteration](https://github.com/tc39/proposal-async-iteration)?
