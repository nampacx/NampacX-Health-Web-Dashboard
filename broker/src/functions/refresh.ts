import { app } from '@azure/functions'
import { BadRequestError } from '../lib/errors.js'
import { withBroker } from '../lib/handler.js'
import { toBrokerResponse } from '../lib/token.js'
import { refreshAccessToken } from '../lib/withings.js'

app.http('withingsTokenRefresh', {
  route: 'withings/token/refresh',
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: withBroker(async (params, config) => {
    const refreshTokenValue = params.get('refresh_token')
    if (!refreshTokenValue) throw new BadRequestError('Missing "refresh_token".')

    const token = await refreshAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: refreshTokenValue,
    })
    return toBrokerResponse(token)
  }),
})
