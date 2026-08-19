import { useRef, useState } from 'react'
import type { BloodworkJob } from '../api/bloodwork/types'

const STATUS_LABELS: Record<BloodworkJob['status'], string> = {
  pending: 'Queued',
  processing: 'Processing…',
  completed: 'Done',
  failed: 'Failed',
}

interface Props {
  jobs: BloodworkJob[]
  uploading: boolean
  uploadError: string | null
  onUpload: (file: File) => void
}

export default function BloodworkUpload({ jobs, uploading, uploadError, onUpload }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleUpload() {
    if (!file) return
    onUpload(file)
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <section className="card bloodwork-upload">
      <h2>Upload a lab report</h2>
      <p className="muted">
        PDF, JPEG, or PNG. Text is extracted with Azure Document Intelligence and matched against
        known analyte codes — this can take a couple of minutes, so feel free to switch tabs and
        come back.
      </p>

      <div className="controls-row">
        <label className="field field-grow">
          <span>File</span>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            disabled={uploading}
          />
        </label>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleUpload}
          disabled={!file || uploading}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {uploadError && <p className="banner banner-error">{uploadError}</p>}

      {jobs.length > 0 && (
        <ul className="bloodwork-jobs">
          {jobs.map((job) => (
            <li key={job.documentId} className="bloodwork-job">
              <span className={`pill bloodwork-job-status bloodwork-job-status-${job.status}`}>
                {STATUS_LABELS[job.status]}
              </span>
              <span className="muted bloodwork-job-meta">
                {job.status === 'completed' &&
                  job.reportDate &&
                  `Report ${job.reportDate} · ${job.rowCount} ${job.rowCount === 1 ? 'row' : 'rows'}`}
                {job.status === 'failed' && (job.errorMessage ?? 'Processing failed.')}
                {(job.status === 'pending' || job.status === 'processing') &&
                  `Uploaded ${new Date(job.createdAt).toLocaleTimeString()}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
