import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  BloodworkApiError,
  correctResult,
  deleteReport,
  fileExtensionFor,
  getJobStatus,
  listResults,
  uploadDocument,
} from '../api/bloodwork/bloodworkApi'
import type {
  BloodworkCorrectionPatch,
  BloodworkJob,
  BloodworkResultsByDate,
} from '../api/bloodwork/types'
import { useGoogleAuth } from '../auth/google/GoogleAuthContext'
import { InteractionRequiredError } from '../auth/google/googleAuth'

/** Terminal states stop polling; anything else keeps checking back. */
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

const POLL_INTERVAL_MS = 3_000
/** ~4 minutes -- generous for a Document Intelligence extraction, not infinite. */
const MAX_POLL_ATTEMPTS = 80

interface BloodworkDataState {
  /** False when VITE_BLOODWORK_API_URL is unset -- the feature is entirely optional. */
  configured: boolean
  resultsByDate: BloodworkResultsByDate
  /** The server capped the response; older reports exist but were not returned. */
  truncated: boolean
  loading: boolean
  error: string | null
  loadedAt: Date | null
  reload: () => void
  /**
   * True when the narrow bloodwork token could not be minted in the background
   * -- almost always a blocked popup, since the scope itself was granted at
   * sign-in. `authorize` retries it from a real click, which is the one context
   * a browser will always allow the popup in.
   */
  needsAuthorization: boolean
  /**
   * Why the last mint failed, or null when it simply has not been asked for
   * yet. Never swallowed: an empty card that reappears after the popup closes
   * is indistinguishable from a broken button, and the first version of this
   * did exactly that -- it hid a real bug (Google returning the full grant,
   * caught by the scope check) behind a silent retry.
   */
  authorizeError: string | null
  authorize: () => Promise<void>
  /** Uploads made this session, newest first. Cleared on sign-out, not persisted. */
  jobs: BloodworkJob[]
  upload: (file: File) => Promise<void>
  uploading: boolean
  uploadError: string | null
  correct: (reportDate: string, analyte: string, patch: BloodworkCorrectionPatch) => Promise<void>
  correcting: boolean
  correctError: string | null
  remove: (reportDate: string) => Promise<void>
  removing: string | null
  removeError: string | null
}

const BloodworkDataContext = createContext<BloodworkDataState | null>(null)

export function BloodworkDataProvider({ children }: { children: ReactNode }) {
  const { status, getIdentityToken } = useGoogleAuth()
  const apiBaseUrl = import.meta.env.VITE_BLOODWORK_API_URL?.trim() || null
  const configured = apiBaseUrl !== null

  const [resultsByDate, setResultsByDate] = useState<BloodworkResultsByDate>({})
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)
  const [needsAuthorization, setNeedsAuthorization] = useState(false)
  const [authorizeError, setAuthorizeError] = useState<string | null>(null)
  // The same value as the state above, readable synchronously. A caller that
  // awaits withToken() and then wants the reason cannot read the state it just
  // set -- that render has not happened yet.
  const lastAuthError = useRef<string | null>(null)

  const [jobs, setJobs] = useState<BloodworkJob[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [correcting, setCorrecting] = useState(false)
  const [correctError, setCorrectError] = useState<string | null>(null)

  const [removing, setRemoving] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Guards against a slow earlier request overwriting a newer result.
  const requestId = useRef(0)
  // documentId -> pending poll timeout, so unmount/sign-out can cancel them.
  const pollTimers = useRef(new Map<string, number>())

  const clearPolls = useCallback(() => {
    for (const timer of pollTimers.current.values()) window.clearTimeout(timer)
    pollTimers.current.clear()
  }, [])

  /**
   * Every call into the API goes through here, so there is exactly one place
   * that decides what token bloodwork is allowed to send. Returning null rather
   * than the Google Health token on failure is the whole point: falling back
   * would hand a full health grant to a backend that needs a subject id.
   *
   * `interactive` is false for everything that runs on its own -- the load
   * effect, the poll loop -- so none of them can open a popup the user did not
   * ask for. They read the cached token or set `needsAuthorization` and stop.
   */
  const withToken = useCallback(
    async (interactive = false): Promise<string | null> => {
      try {
        const token = await getIdentityToken({ interactive })
        setNeedsAuthorization(false)
        lastAuthError.current = null
        setAuthorizeError(null)
        return token
      } catch (err) {
        setNeedsAuthorization(true)
        // InteractionRequired is the ordinary answer for a background caller,
        // not something to report. Everything else is a real failure and has to
        // be visible, or the card just silently reappears.
        lastAuthError.current =
          err instanceof InteractionRequiredError
            ? null
            : err instanceof Error
              ? err.message
              : String(err)
        setAuthorizeError(lastAuthError.current)
        return null
      }
    },
    [getIdentityToken],
  )

  const load = useCallback(async () => {
    if (status !== 'signed-in' || !apiBaseUrl) return
    const token = await withToken()
    if (!token) return

    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const page = await listResults(apiBaseUrl, token)
      if (id !== requestId.current) return
      setResultsByDate(page.results)
      setTruncated(page.truncated)
      setLoadedAt(new Date())
    } catch (err) {
      if (id !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [status, apiBaseUrl, withToken])

  useEffect(() => {
    void load()
  }, [load])

  // Signing out must not leave results or in-flight jobs readable, and must
  // not let a stray poll from the old session keep firing.
  useEffect(() => {
    if (status === 'signed-in') return
    requestId.current++
    clearPolls()
    setResultsByDate({})
    setTruncated(false)
    setLoadedAt(null)
    setError(null)
    setJobs([])
    setUploadError(null)
    setRemoveError(null)
    setNeedsAuthorization(false)
    setAuthorizeError(null)
  }, [status, clearPolls])

  useEffect(() => clearPolls, [clearPolls])

  /**
   * Retries the token mint from a user gesture. The popup GIS opens to run it is
   * blocked outside one, which is the usual reason the background attempt failed.
   */
  const authorize = useCallback(async () => {
    const token = await withToken(true)
    if (token) await load()
  }, [withToken, load])

  const pollJob = useCallback(
    (documentId: string, attempt: number) => {
      if (attempt >= MAX_POLL_ATTEMPTS) return
      const timer = window.setTimeout(async () => {
        pollTimers.current.delete(documentId)
        if (!apiBaseUrl) return
        const token = await withToken()
        if (!token) return
        try {
          const job = await getJobStatus(apiBaseUrl, token, documentId)
          setJobs((prev) => prev.map((j) => (j.documentId === documentId ? job : j)))
          if (TERMINAL_STATUSES.has(job.status)) {
            if (job.status === 'completed') void load()
            return
          }
        } catch {
          // A transient blip mid-processing shouldn't kill the poll loop --
          // just try again next interval.
        }
        pollJob(documentId, attempt + 1)
      }, POLL_INTERVAL_MS)
      pollTimers.current.set(documentId, timer)
    },
    [apiBaseUrl, withToken, load],
  )

  const upload = useCallback(
    async (file: File) => {
      if (!apiBaseUrl) return
      if (!fileExtensionFor(file.type)) {
        setUploadError(`Unsupported file type "${file.type || 'unknown'}". Use a PDF, JPEG, or PNG.`)
        return
      }
      const token = await withToken(true)
      if (!token) {
        setUploadError(lastAuthError.current ?? 'Could not get permission to reach the bloodwork API. Try again.')
        return
      }

      setUploading(true)
      setUploadError(null)
      try {
        const { documentId } = await uploadDocument({ apiBaseUrl, identityToken: token, file })
        const now = new Date().toISOString()
        const job: BloodworkJob = {
          documentId,
          status: 'pending',
          errorCode: null,
          errorMessage: null,
          reportDate: null,
          rowCount: null,
          createdAt: now,
          updatedAt: now,
        }
        setJobs((prev) => [job, ...prev])
        pollJob(documentId, 0)
      } catch (err) {
        setUploadError(
          err instanceof BloodworkApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err),
        )
      } finally {
        setUploading(false)
      }
    },
    [apiBaseUrl, withToken, pollJob],
  )

  const correct = useCallback(
    async (reportDate: string, rowKey: string, patch: BloodworkCorrectionPatch) => {
      if (!apiBaseUrl) return
      const token = await withToken(true)
      if (!token) {
        setCorrectError(lastAuthError.current ?? 'Could not get permission to reach the bloodwork API. Try again.')
        return
      }

      setCorrecting(true)
      setCorrectError(null)
      try {
        const updated = await correctResult(apiBaseUrl, token, reportDate, rowKey, patch)
        setResultsByDate((prev) => {
          const rows = prev[reportDate]
          if (!rows) return prev
          return {
            ...prev,
            [reportDate]: rows.map((row) => (row.rowKey === rowKey ? updated : row)),
          }
        })
      } catch (err) {
        setCorrectError(err instanceof Error ? err.message : String(err))
      } finally {
        setCorrecting(false)
      }
    },
    [apiBaseUrl, withToken],
  )

  const remove = useCallback(
    async (reportDate: string) => {
      if (!apiBaseUrl) return
      const token = await withToken(true)
      if (!token) {
        setRemoveError(lastAuthError.current ?? 'Could not get permission to reach the bloodwork API. Try again.')
        return
      }

      setRemoving(reportDate)
      setRemoveError(null)
      try {
        await deleteReport(apiBaseUrl, token, reportDate)
        // Dropped locally rather than refetched: the server has already
        // confirmed the rows are gone, and a reload would repaint the whole
        // table to show one card missing.
        setResultsByDate((prev) => {
          const next = { ...prev }
          delete next[reportDate]
          return next
        })
        // Jobs for the deleted report are gone server-side too; a status poll
        // would now 404, so they must not stay on screen as if they existed.
        setJobs((prev) => prev.filter((job) => job.reportDate !== reportDate))
      } catch (err) {
        setRemoveError(err instanceof Error ? err.message : String(err))
      } finally {
        setRemoving(null)
      }
    },
    [apiBaseUrl, withToken],
  )

  const value = useMemo<BloodworkDataState>(
    () => ({
      configured,
      resultsByDate,
      truncated,
      loading,
      error,
      loadedAt,
      reload: () => void load(),
      needsAuthorization,
      authorizeError,
      authorize,
      jobs,
      upload,
      uploading,
      uploadError,
      correct,
      correcting,
      correctError,
      remove,
      removing,
      removeError,
    }),
    [
      configured,
      resultsByDate,
      truncated,
      loading,
      error,
      loadedAt,
      load,
      needsAuthorization,
      authorizeError,
      authorize,
      jobs,
      upload,
      uploading,
      uploadError,
      correct,
      correcting,
      correctError,
      remove,
      removing,
      removeError,
    ],
  )

  return <BloodworkDataContext.Provider value={value}>{children}</BloodworkDataContext.Provider>
}

export function useBloodworkData(): BloodworkDataState {
  const ctx = useContext(BloodworkDataContext)
  if (!ctx) throw new Error('useBloodworkData must be used inside <BloodworkDataProvider>')
  return ctx
}
