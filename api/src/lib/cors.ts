import type { HttpRequest, HttpResponseInit } from '@azure/functions'

/**
 * CORS is implemented entirely here, in code, and the platform's own CORS
 * setting (the portal blade, `Host.CORS` in local.settings.json) is left
 * empty on purpose. If both emit `Access-Control-Allow-Origin`, the browser
 * sees two values on the response and rejects it outright — pick one.
 */
export function corsHeaders(request: HttpRequest, allowedOrigins: string[]): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  }
}

/** Origin is trivially forgeable (curl sends whatever it likes); this is a
 * browser-abuse control, not a security boundary. The actual security
 * boundary is the client_secret staying server-side. */
export function preflightResponse(
  request: HttpRequest,
  allowedOrigins: string[],
): HttpResponseInit | null {
  if (request.method !== 'OPTIONS') return null
  return {
    status: 204,
    headers: {
      ...corsHeaders(request, allowedOrigins),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '3600',
    },
  }
}
