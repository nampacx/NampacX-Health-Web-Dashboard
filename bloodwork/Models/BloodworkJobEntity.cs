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

    /// <summary>ISO YYYY-MM-DD. Set on completion -- matches the resulting rows' PartitionKey in bloodworkResults.</summary>
    public string? ReportDate { get; set; }

    /// <summary>Set on completion.</summary>
    public int? RowCount { get; set; }

    /// <summary>Set on failure.</summary>
    public string? ErrorMessage { get; set; }
}
