export const P_RESOLVED = Promise.resolve()

export const CLOSED = { desc: '<closed>', inspect: () => '<closed>', toString: () => '<closed>' }
export const FAILED = { desc: '<failed>', inspect: () => '<failed>', toString: () => '<failed>' }

export function nop() {}
