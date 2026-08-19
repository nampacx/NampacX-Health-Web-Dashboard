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

/** Terminal states stop polling; anything else keeps checking back. */
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

const POLL_INTERVAL_MS = 3_000
/** ~4 minutes -- generous for a Document Intelligence extraction, not infinite. */
const MAX_POLL_ATTEMPTS = 80

interface BloodworkDataState {
  /** False when VITE_BLOODWORK_API_URL is unset -- the feature is entirely optional. */
  configured: boolean
  resultsByDate: BloodworkResultsByDate
  loading: boolean
  error: string | null
  loadedAt: Date | null
  reload: () => void
  /** Uploads made this session, newest first. Cleared on sign-out, not persisted. */
  jobs: BloodworkJob[]
  upload: (file: File) => Promise<void>
  uploading: boolean
  uploadError: string | null
  correct: (reportDate: string, analyte: string, patch: BloodworkCorrectionPatch) => Promise<void>
  correcting: boolean
  correctError: string | null
}

const BloodworkDataContext = createContext<BloodworkDataState | null>(null)

export function BloodworkDataProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken } = useGoogleAuth()
  const apiBaseUrl = import.meta.env.VITE_BLOODWORK_API_URL?.trim() || null
  const configured = apiBaseUrl !== null

  const [resultsByDate, setResultsByDate] = useState<BloodworkResultsByDate>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<Date | null>(null)

  const [jobs, setJobs] = useState<BloodworkJob[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [correcting, setCorrecting] = useState(false)
  const [correctError, setCorrectError] = useState<string | null>(null)

  // Guards against a slow earlier request overwriting a newer result.
  const requestId = useRef(0)
  // documentId -> pending poll timeout, so unmount/sign-out can cancel them.
  const pollTimers = useRef(new Map<string, number>())

  const clearPolls = useCallback(() => {
    for (const timer of pollTimers.current.values()) window.clearTimeout(timer)
    pollTimers.current.clear()
  }, [])

  const load = useCallback(async () => {
    if (status !== 'signed-in' || !apiBaseUrl) return
    const token = getAccessToken()
    if (!token) return

    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const data = await listResults(apiBaseUrl, token)
      if (id !== requestId.current) return
      setResultsByDate(data)
      setLoadedAt(new Date())
    } catch (err) {
      if (id !== requestId.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [status, apiBaseUrl, getAccessToken])

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
    setLoadedAt(null)
    setError(null)
    setJobs([])
    setUploadError(null)
  }, [status, clearPolls])

  useEffect(() => clearPolls, [clearPolls])

  const pollJob = useCallback(
    (documentId: string, attempt: number) => {
      if (attempt >= MAX_POLL_ATTEMPTS) return
      const timer = window.setTimeout(async () => {
        pollTimers.current.delete(documentId)
        const token = getAccessToken()
        if (!token || !apiBaseUrl) return
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
    [apiBaseUrl, getAccessToken, load],
  )

  const upload = useCallback(
    async (file: File) => {
      if (!apiBaseUrl) return
      const token = getAccessToken()
      if (!token) {
        setUploadError('Your Google session expired. Sign in again to upload.')
        return
      }
      if (!fileExtensionFor(file.type)) {
        setUploadError(`Unsupported file type "${file.type || 'unknown'}". Use a PDF, JPEG, or PNG.`)
        return
      }

      setUploading(true)
      setUploadError(null)
      try {
        const { documentId } = await uploadDocument({ apiBaseUrl, accessToken: token, file })
        const now = new Date().toISOString()
        const job: BloodworkJob = {
          documentId,
          status: 'pending',
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
    [apiBaseUrl, getAccessToken, pollJob],
  )

  const correct = useCallback(
    async (reportDate: string, rowKey: string, patch: BloodworkCorrectionPatch) => {
      if (!apiBaseUrl) return
      const token = getAccessToken()
      if (!token) {
        setCorrectError('Your Google session expired. Sign in again to make corrections.')
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
    [apiBaseUrl, getAccessToken],
  )

  const value = useMemo<BloodworkDataState>(
    () => ({
      configured,
      resultsByDate,
      loading,
      error,
      loadedAt,
      reload: () => void load(),
      jobs,
      upload,
      uploading,
      uploadError,
      correct,
      correcting,
      correctError,
    }),
    [
      configured,
      resultsByDate,
      loading,
      error,
      loadedAt,
      load,
      jobs,
      upload,
      uploading,
      uploadError,
      correct,
      correcting,
      correctError,
    ],
  )

  return <BloodworkDataContext.Provider value={value}>{children}</BloodworkDataContext.Provider>
}

export function useBloodworkData(): BloodworkDataState {
  const ctx = useContext(BloodworkDataContext)
  if (!ctx) throw new Error('useBloodworkData must be used inside <BloodworkDataProvider>')
  return ctx
}
