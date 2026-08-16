import { describe, expect, it } from 'vitest'
import { toBrokerResponse } from './token.js'

describe('toBrokerResponse', () => {
  it('camelCases the Withings envelope and stringifies userid', () => {
    const result = toBrokerResponse({
      access_token: 'a',
      refresh_token: 'r',
      expires_in: 10800,
      scope: 'user.metrics',
      userid: 123456,
    })
    expect(result).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 10800,
      scope: 'user.metrics',
      userId: '123456',
    })
  })
})
