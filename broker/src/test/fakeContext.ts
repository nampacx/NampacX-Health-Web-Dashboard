import type { InvocationContext } from '@azure/functions'

export function fakeContext(): InvocationContext {
  return { error: () => {}, log: () => {}, warn: () => {} } as unknown as InvocationContext
}
