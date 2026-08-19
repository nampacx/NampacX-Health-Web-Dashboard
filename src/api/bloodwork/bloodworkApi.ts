/**
 * bloodwork/ Azure Function client. Every route is Authorization: Bearer
 * <Google access token> -- the SAME token the Google Health API calls use,
 * verified server-side by GoogleAuthMiddleware; there is no separate
 * bloodwork sign-in. Unlike Withings, this API uses real HTTP status codes
 * and a {error, message} JSON body (see bloodwork/Middleware/ErrorMapper.cs),
 * so response.ok is meaningful here.
 */

import type {
  BloodworkCorrectionPatch,
  BloodworkJob,
  BloodworkResultRow,
  BloodworkResultsByDate,
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
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${trimBase(apiBaseUrl)}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${accessToken}`,
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
  accessToken: string
  file: File
}

export async function uploadDocument({
  apiBaseUrl,
  accessToken,
  file,
}: UploadDocumentOptions): Promise<{ documentId: string }> {
  return request(apiBaseUrl, '/bloodwork/upload', accessToken, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  })
}

export async function getJobStatus(
  apiBaseUrl: string,
  accessToken: string,
  documentId: string,
): Promise<BloodworkJob> {
  return request(apiBaseUrl, `/bloodwork/jobs/${encodeURIComponent(documentId)}`, accessToken)
}

export async function listResults(
  apiBaseUrl: string,
  accessToken: string,
): Promise<BloodworkResultsByDate> {
  return request(apiBaseUrl, '/bloodwork/data', accessToken)
}

export async function correctResult(
  apiBaseUrl: string,
  accessToken: string,
  reportDate: string,
  analyte: string,
  patch: BloodworkCorrectionPatch,
): Promise<BloodworkResultRow> {
  return request(
    apiBaseUrl,
    `/bloodwork/data/${encodeURIComponent(reportDate)}/${encodeURIComponent(analyte)}`,
    accessToken,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
}
