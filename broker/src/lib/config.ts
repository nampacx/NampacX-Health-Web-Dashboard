/** Reads and validates the app settings the broker needs. Fails loudly. */

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface BrokerConfig {
  clientId: string
  clientSecret: string
  allowedOrigins: string[]
  allowedRedirectUris: string[]
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const clientId = env.WITHINGS_CLIENT_ID?.trim()
  const clientSecret = env.WITHINGS_CLIENT_SECRET?.trim()
  const allowedOrigins = splitList(env.ALLOWED_ORIGINS)
  const allowedRedirectUris = splitList(env.ALLOWED_REDIRECT_URIS)

  if (!clientId) throw new ConfigError('WITHINGS_CLIENT_ID is not set.')
  if (!clientSecret) throw new ConfigError('WITHINGS_CLIENT_SECRET is not set.')
  if (allowedOrigins.length === 0) throw new ConfigError('ALLOWED_ORIGINS is not set.')
  if (allowedRedirectUris.length === 0) throw new ConfigError('ALLOWED_REDIRECT_URIS is not set.')

  return { clientId, clientSecret, allowedOrigins, allowedRedirectUris }
}
