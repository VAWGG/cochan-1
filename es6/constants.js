export const P_RESOLVED = Promise.resolve()
export const P_RESOLVED_WITH_FALSE = Promise.resolve(false)
export const P_RESOLVED_WITH_TRUE = Promise.resolve(true)

export const CLOSED = { desc: '<closed>', inspect: () => '<closed>', toString: () => '<closed>' }
export const FAILED = { desc: '<failed>', inspect: () => '<failed>', toString: () => '<failed>' }

export function nop() {}
