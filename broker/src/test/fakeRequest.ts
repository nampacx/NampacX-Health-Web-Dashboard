import type { HttpRequest } from '@azure/functions'

/** Minimal duck-typed HttpRequest for tests -- only the members our code touches. */
export function fakeRequest(opts: {
  method?: string
  origin?: string | null
  body?: string
}): HttpRequest {
  const headers = new Map<string, string>()
  if (opts.origin) headers.set('origin', opts.origin)

  return {
    method: opts.method ?? 'POST',
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null } as HttpRequest['headers'],
    text: async () => opts.body ?? '',
  } as HttpRequest
}
