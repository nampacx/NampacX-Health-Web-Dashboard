using Azure;
using Azure.Data.Tables;

namespace Bloodwork.Models;

/// <summary>
/// A row in the <c>bloodworkJobs</c> table -- one per uploaded document. A
/// constant PartitionKey ("job") is deliberate: Table Storage sustains
/// ~2000 tx/s per partition, and this app produces at most low hundreds of
/// documents over its lifetime, so splitting by date/month here would be
/// complexity with no benefit.
/// </summary>
public sealed class BloodworkJobEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "job";

    /// <summary>The documentId (a GUID) assigned at upload time.</summary>
    public string RowKey { get; set; } = string.Empty;

    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    /// <summary>"pending" | "processing" | "completed" | "failed"</summary>
    public string Status { get; set; } = "pending";

    /// <summary>The uploader's Google subject id, from the verified access token at upload time.</summary>
    public string Sub { get; set; } = string.Empty;

    public string BlobName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;

    /// <summary>ISO 8601.</summary>
    public string CreatedAt { get; set; } = string.Empty;

    /// <summary>ISO 8601.</summary>
    public string UpdatedAt { get; set; } = string.Empty;

    /// <summary>ISO YYYY-MM-DD. Set on completion -- matches the resulting rows' ReportDate in bloodworkResults (and the prefix of their RowKey).</summary>
    public string? ReportDate { get; set; }

    /// <summary>Set on completion.</summary>
    public int? RowCount { get; set; }

    /// <summary>
    /// Set on failure -- a stable, machine-readable reason, following
    /// <c>ParseException.Code</c>'s pattern. Together with
    /// <see cref="ErrorMessage"/> it replaces what used to be stored here: the
    /// raw text of whatever exception was caught, which on the catch-all path
    /// was typically a RequestFailedException carrying the storage or Document
    /// Intelligence endpoint host, the service error code and its request-id
    /// headers -- all of it persisted, returned to the caller and painted into
    /// the UI.
    /// </summary>
    public string? ErrorCode { get; set; }

    /// <summary>
    /// Set on failure -- the human-readable half, and safe to display. Every
    /// value it can hold is written by this app for the user to read: either a
    /// LayoutParser message ("report_date_not_found" and friends, which are
    /// genuinely actionable) or one fixed string for everything else.
    /// </summary>
    public string? ErrorMessage { get; set; }
}
