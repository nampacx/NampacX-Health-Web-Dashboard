import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { type BrokerConfig, loadConfig } from './config.js'
import { corsHeaders, preflightResponse } from './cors.js'
import { toHttpResponse } from './errors.js'

// `object`, not `Record<string, unknown>`: exchange/refresh return distinct,
// non-index-signature response shapes (BrokerTokenResponse). This wrapper
// only needs to know the result is JSON-serialisable, not its exact shape.
type BrokerHandler = (
  params: URLSearchParams,
  config: BrokerConfig,
  request: HttpRequest,
  context: InvocationContext,
) => Promise<object>

function summarize(err: unknown): string {
  // Never log request bodies or token values -- only the error shape.
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

/**
 * Wraps a POST handler with: config loading, OPTIONS preflight, CORS headers
 * on every response (including errors, so the SPA can actually read the
 * error body instead of seeing an opaque CORS failure), and error mapping.
 */
export function withBroker(handler: BrokerHandler) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    let config: BrokerConfig
    try {
      config = loadConfig()
    } catch (err) {
      // No allowlist to consult yet. Echo the origin permissively for this
      // one error body -- it carries no secret, only a setup message, and a
      // deployment this broken cannot serve a real request either way.
      const response = toHttpResponse(err)
      return { ...response, headers: { ...response.headers, 'Access-Control-Allow-Origin': '*' } }
    }

    const preflight = preflightResponse(request, config.allowedOrigins)
    if (preflight) return preflight

    const headers = corsHeaders(request, config.allowedOrigins)

    try {
      const params = new URLSearchParams(await request.text())
      const body = await handler(params, config, request, context)
      return { status: 200, jsonBody: body, headers }
    } catch (err) {
      context.error(summarize(err))
      const response = toHttpResponse(err)
      return { ...response, headers: { ...response.headers, ...headers } }
    }
  }
}
