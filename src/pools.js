import Pool from './pool'
import {Thenable} from './thenable'

export const arrayPool = new Pool({
  name: 'Array',
  initialCapacity: 5,
  maxCapacity: 100,
  makeNew: () => [],
  reset: (arr) => { arr.length = 0 }
})
