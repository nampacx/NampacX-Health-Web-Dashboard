/**
 * The pieces every Google Health endpoint needs: the base URL, the error type,
 * and the error-body unwrapper.
 *
 * Split out of `healthApi.ts` purely to break an import cycle — `rollup.ts` needs
 * all three, and `healthApi.ts` needs `rollup.ts` to route the data types that
 * cannot be listed. `healthApi.ts` re-exports them, so nothing else had to move.
 */

// health.googleapis.com returns Access-Control-Allow-Origin for arbitrary
// origins and permits the `authorization` header, so the browser can call it
// directly — no proxy required, in development or on a static host.
export const API_BASE = 'https://health.googleapis.com/v4'

export class HealthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly dataTypeId?: string,
  ) {
    super(message)
    this.name = 'HealthApiError'
  }
}

/**
 * The human-readable part of an error response. Exported because the endpoints
 * outside the dataPoints collection (`profile.ts`, `exerciseTcx.ts`) need the
 * same unwrapping but say something different about the status code.
 */
export function readApiMessage(body: string): string {
  try {
    return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? ''
  } catch {
    return body.slice(0, 200)
  }
}

