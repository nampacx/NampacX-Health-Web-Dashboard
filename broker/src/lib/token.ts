import type { WithingsTokenBody } from './withings.js'

/** The Withings envelope never reaches the SPA; this is what does, camelCased. */
export interface BrokerTokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
  userId: string
}

export function toBrokerResponse(token: WithingsTokenBody): BrokerTokenResponse {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: token.expires_in,
    scope: token.scope,
    userId: String(token.userid),
  }
}
