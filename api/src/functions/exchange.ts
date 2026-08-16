import { app } from '@azure/functions'
import { BadRequestError } from '../lib/errors.js'
import { withBroker } from '../lib/handler.js'
import { toBrokerResponse } from '../lib/token.js'
import { exchangeAuthorizationCode } from '../lib/withings.js'

app.http('withingsTokenExchange', {
  route: 'withings/token/exchange',
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  handler: withBroker(async (params, config) => {
    const code = params.get('code')
    const redirectUri = params.get('redirect_uri')
    if (!code) throw new BadRequestError('Missing "code".')
    if (!redirectUri) throw new BadRequestError('Missing "redirect_uri".')
    // Stops the broker being used to mint tokens for someone else's redirect.
    if (!config.allowedRedirectUris.includes(redirectUri)) {
      throw new BadRequestError('redirect_uri is not in the allowed list.')
    }

    const token = await exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
    })
    return toBrokerResponse(token)
  }),
})
