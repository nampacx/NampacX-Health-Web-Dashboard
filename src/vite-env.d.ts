/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_HEALTH_API_BASE?: string
  /** Public by design, like the Google client ID. */
  readonly VITE_WITHINGS_CLIENT_ID?: string
  /** Base URL of the Azure Function token broker, e.g. https://<app>.azurewebsites.net/api */
  readonly VITE_WITHINGS_BROKER_URL?: string
  /** Overrides the computed redirect URI; must match the Withings app registration byte-for-byte. */
  readonly VITE_WITHINGS_REDIRECT_URI?: string
  /** Set to "1" to append mode=demo to the authorize URL. */
  readonly VITE_WITHINGS_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Minimal typings for the Google Identity Services script loaded in index.html.
declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token: string
    expires_in: number
    scope: string
    token_type: string
    error?: string
    error_description?: string
  }

  interface TokenClient {
    requestAccessToken(overrides?: { prompt?: '' | 'none' | 'consent' | 'select_account' }): void
  }

  interface TokenClientConfig {
    client_id: string
    scope: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type: string; message?: string }) => void
    prompt?: string
  }

  function initTokenClient(config: TokenClientConfig): TokenClient
  function revoke(accessToken: string, done?: () => void): void
}
