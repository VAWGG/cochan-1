import Pool from './pool'
import {Thenable} from './thenable'

export const arrayPool = new Pool({
  name: 'Array',
  initialCapacity: 5,
  maxCapacity: 100,
  makeNew: () => [],
  reset: (arr) => { arr.length = 0 }
})

export const thenablePool = new Pool({
  name: 'Thenable',
  initialCapacity: 5,
  maxCapacity: 100,
  makeNew: () => new Thenable(undefined, 0),
  reset: (th) => { th._reuse() },
  prepare: (th) => { th._unseal() }
})
