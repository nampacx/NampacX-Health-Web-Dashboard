import type { HttpResponseInit } from '@azure/functions'
import { ConfigError } from './config.js'
import { WithingsTokenError } from './withings.js'

/** Our own bug or a bad request — never means the caller's grant is dead. */
export class BadRequestError extends Error {}

function jsonResponse(status: number, body: Record<string, unknown>): HttpResponseInit {
  return { status, jsonBody: body }
}

/**
 * Maps an error to an HTTP response using REAL status codes, deliberately
 * unlike Withings — the SPA's decision to clear or keep the stored refresh
 * token hinges on this distinction. Only 401 means the grant itself is dead;
 * everything else must leave the SPA's stored tokens untouched.
 */
export function toHttpResponse(err: unknown): HttpResponseInit {
  if (err instanceof BadRequestError) {
    return jsonResponse(400, { error: 'bad_request', message: err.message })
  }
  if (err instanceof ConfigError) {
    return jsonResponse(500, { error: 'misconfigured', message: err.message })
  }
  if (err instanceof WithingsTokenError) {
    switch (err.kind) {
      case 'invalid_grant':
        return jsonResponse(401, { error: 'invalid_grant', message: err.message })
      case 'misconfigured':
        return jsonResponse(500, { error: 'misconfigured', message: err.message })
      case 'network':
      case 'upstream':
        return jsonResponse(502, { error: 'upstream', message: err.message })
    }
  }
  return jsonResponse(500, { error: 'internal', message: 'Unexpected error.' })
}
