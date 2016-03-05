# cochan

Channel communication primitive, modelled after [golang channels]. Useful for
communication between concurrent activities, e.g. coroutines. Plays especially
well with generators or ES7 async/await, but doesn't depend on these language
features. Depends on `Promise` being available.

Supports buffering, selection from multiple channels, non-blocking operations,
errors and channel closing.

[golang channels]: https://tour.golang.org/concurrency/2

You can find all examples inside the [_examples](_examples) directory.
Run them by cloning this repo, doing `npm install` and then
`./run-example _examples/path/to_example.js` (requires Node 4 or later).


## Usage

To install from NPM:

```test
npm i -S cochan
```

Basic usage with async/await:

```js
import chan from 'cochan'

let ch = new chan()

async function producerThatRespectsBackpressure() {
  await ch.put('a')
  await ch.put('b')
  await ch.put('c')
}

function producerThatDoesntRespectBackpressure() {
  ch.put('1')
  ch.put('2')
}

async function consumer() {
  while (true) {
    let item = await ch.take()
    if (item == ch.CLOSED) break
    console.log(`item: ${ item }`)
  }
}

producerThatRespectsBackpressure()
producerThatDoesntRespectBackpressure()
consumer()

// outputs: a, 1, 2, b, c
```

Selection from multiple channels:

```js
import chan from 'cochan'

async function someFunc(ch1, ch2) {
  let chTimeout = chan.timeout(5000, 'no value in 5 sec')
  // the await statement will throw on timeout
  switch (await chan.select(ch1, ch2, chTimeout)) {
    case ch1:
      await doSmthWithValueFromCh1(ch1.value)
      break
    case ch2:
      await doSmthWithValueFromCh2(ch2.value)
      break
    case chan.CLOSED:
      await handleBothCh1AndCh2Closed()
      break
  }
}
```

When several channels have some value, the channel to take the value from
is selected randomly.


## Basic buffering

```js
import chan from 'cochan'

// allow buffering up to 3 items without blocking
let ch = new chan(3)

async function producer(items) {
  for (let item of items) {
    console.log(`[P] putting item: ${ item }...`)
    await ch.put(item)
  }
  console.log(`[P] closing channel...`)
  await ch.close()
  console.log(`[P] channel closed`)
}

async function consumer() {
  while (true) {
    let item = await ch.take()
    if (item == ch.CLOSED) break
    console.log(`[c] got item: ${ item }`)
  }
  console.log(`[c] finished`)
}

(async function() {
  producer([ 1, 2, 3, 4, 5 ])
  await chan.delay(500).take()
  consumer()
})()
```

This example yields the following output:

```text
[P] putting item: 1...
[P] putting item: 2...
[P] putting item: 3...
[P] putting item: 4...
[c] got item: 1
[c] got item: 2
[c] got item: 3
[c] got item: 4
[P] putting item: 5...
[c] got item: 5
[P] closing channel...
[c] finished
[P] channel closed
```

* [The same example with generators and co](_examples/generators-co/1-buffer.js)
* [The same with Promises](_examples/promises/1-buffer.js)


## Selection

See [this example](_examples/async-await/2-select.js)


## TODO

* API docs.
* More examples (non-blocking, wait, delay, real-world).
