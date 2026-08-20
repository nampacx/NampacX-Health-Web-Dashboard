/**
 * bloodwork/ Azure Function client.
 *
 * Every route is `Authorization: Bearer <token>`, verified server-side by
 * GoogleAuthMiddleware — but **not** the token the Google Health calls use.
 * That one carries every `googlehealth.*.readonly` scope the app requests, and
 * this API needs an identity, not a health record. What is sent here is minted
 * separately and scoped to `IDENTITY_SCOPES`; see `src/auth/google/googleAuth.ts`
 * for the reasoning, and `useGoogleAuth().getIdentityToken()` for how callers
 * get one. There is still no separate bloodwork sign-in.
 *
 * Unlike Withings, this API uses real HTTP status codes and a {error, message}
 * JSON body (see bloodwork/Middleware/ErrorMapper.cs), so response.ok is
 * meaningful here.
 */

import type {
  BloodworkCorrectionPatch,
  BloodworkJob,
  BloodworkResultRow,
  BloodworkResultsPage,
} from './types'

/** Mirrors UploadFunction.cs's AllowedContentTypes. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
}

export class BloodworkApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'BloodworkApiError'
  }
}

function trimBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, '')
}

async function request<T>(
  apiBaseUrl: string,
  path: string,
  identityToken: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${trimBase(apiBaseUrl)}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${identityToken}`,
      },
    })
  } catch (err) {
    throw new BloodworkApiError(
      `Network request to the bloodwork API failed. (${err instanceof Error ? err.message : String(err)})`,
      0,
    )
  }

  if (!response.ok) {
    let code: string | undefined
    let message = `Bloodwork API returned HTTP ${response.status}.`
    try {
      const body = (await response.json()) as { error?: string; message?: string }
      if (body.message) message = body.message
      code = body.error
    } catch {
      // Body wasn't JSON (e.g. a platform-level 502) -- fall back to the generic message above.
    }
    throw new BloodworkApiError(message, response.status, code)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** Rejects client-side before spending a request on a type the API will reject anyway. */
export function fileExtensionFor(contentType: string): string | undefined {
  return ALLOWED_UPLOAD_TYPES[contentType]
}

export interface UploadDocumentOptions {
  apiBaseUrl: string
  identityToken: string
  file: File
}

export async function uploadDocument({
  apiBaseUrl,
  identityToken,
  file,
}: UploadDocumentOptions): Promise<{ documentId: string }> {
  return request(apiBaseUrl, '/bloodwork/upload', identityToken, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  })
}

export async function getJobStatus(
  apiBaseUrl: string,
  identityToken: string,
  documentId: string,
): Promise<BloodworkJob> {
  return request(apiBaseUrl, `/bloodwork/jobs/${encodeURIComponent(documentId)}`, identityToken)
}

/** Inclusive at both ends; either half may be omitted. ISO YYYY-MM-DD. */
export interface BloodworkDateRange {
  from?: string
  to?: string
}

export async function listResults(
  apiBaseUrl: string,
  identityToken: string,
  range?: BloodworkDateRange,
): Promise<BloodworkResultsPage> {
  const query = new URLSearchParams()
  if (range?.from) query.set('from', range.from)
  if (range?.to) query.set('to', range.to)
  const suffix = query.size > 0 ? `?${query}` : ''
  return request(apiBaseUrl, `/bloodwork/data${suffix}`, identityToken)
}

export async function correctResult(
  apiBaseUrl: string,
  identityToken: string,
  reportDate: string,
  analyte: string,
  patch: BloodworkCorrectionPatch,
): Promise<BloodworkResultRow> {
  return request(
    apiBaseUrl,
    `/bloodwork/data/${encodeURIComponent(reportDate)}/${encodeURIComponent(analyte)}`,
    identityToken,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
}

/**
 * Erases one report: its rows, the job that produced them, and the uploaded
 * document itself. 204 on success; 404 if the date holds nothing of yours.
 */
export async function deleteReport(
  apiBaseUrl: string,
  identityToken: string,
  reportDate: string,
): Promise<void> {
  return request(apiBaseUrl, `/bloodwork/data/${encodeURIComponent(reportDate)}`, identityToken, {
    method: 'DELETE',
  })
}
