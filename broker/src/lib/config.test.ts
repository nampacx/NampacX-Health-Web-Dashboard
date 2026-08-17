import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './config.js'

const FULL_ENV = {
  WITHINGS_CLIENT_ID: 'cid',
  WITHINGS_CLIENT_SECRET: 'secret',
  ALLOWED_ORIGINS: 'https://mikokono.de, http://localhost:5173',
  ALLOWED_REDIRECT_URIS: 'https://mikokono.de/Google-Health-Web-Dashboard/',
} as NodeJS.ProcessEnv

describe('loadConfig', () => {
  it('loads a fully configured environment', () => {
    const config = loadConfig(FULL_ENV)
    expect(config.clientId).toBe('cid')
    expect(config.clientSecret).toBe('secret')
    expect(config.allowedOrigins).toEqual(['https://mikokono.de', 'http://localhost:5173'])
    expect(config.allowedRedirectUris).toEqual(['https://mikokono.de/Google-Health-Web-Dashboard/'])
  })

  it('trims whitespace around comma-separated list entries', () => {
    const config = loadConfig({ ...FULL_ENV, ALLOWED_ORIGINS: ' a ,  b  ,c' } as NodeJS.ProcessEnv)
    expect(config.allowedOrigins).toEqual(['a', 'b', 'c'])
  })

  it.each([
    ['WITHINGS_CLIENT_ID', 'WITHINGS_CLIENT_ID is not set.'],
    ['WITHINGS_CLIENT_SECRET', 'WITHINGS_CLIENT_SECRET is not set.'],
    ['ALLOWED_ORIGINS', 'ALLOWED_ORIGINS is not set.'],
    ['ALLOWED_REDIRECT_URIS', 'ALLOWED_REDIRECT_URIS is not set.'],
  ])('throws ConfigError when %s is missing', (key, message) => {
    const env = { ...FULL_ENV, [key]: undefined } as NodeJS.ProcessEnv
    expect(() => loadConfig(env)).toThrow(ConfigError)
    expect(() => loadConfig(env)).toThrow(message)
  })

  it('treats an empty or whitespace-only value the same as missing', () => {
    expect(() => loadConfig({ ...FULL_ENV, WITHINGS_CLIENT_ID: '   ' } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    )
    expect(() => loadConfig({ ...FULL_ENV, ALLOWED_ORIGINS: ',,' } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    )
  })
})
