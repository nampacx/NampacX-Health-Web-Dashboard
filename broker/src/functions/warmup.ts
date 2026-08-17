import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'

/**
 * Fired on the "Connect Withings" click, before the redirect, so the
 * exchange call a few seconds later lands on a warm Function instead of
 * eating a cold start out of the authorization code's 30-second lifetime.
 * Deliberately does nothing sensitive, so a permissive CORS response is fine
 * without loading the broker config.
 */
app.http('withingsWarmup', {
  route: 'withings/warmup',
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
        },
      }
    }
    return { status: 200, jsonBody: { ok: true }, headers: { 'Access-Control-Allow-Origin': '*' } }
  },
})
