using Azure;
using Azure.Data.Tables;

namespace Bloodwork.Models;

/// <summary>
/// A row in the <c>bloodworkResults</c> table -- one per analyte per report.
/// PartitionKey is the report date (ISO YYYY-MM-DD, taken from "vom
/// DD.MM.YYYY" in the document, not the "Datum:" print date); RowKey is the
/// lab's own short analyte code from the "Analyse" column (sanitized against
/// Table Storage's forbidden RowKey characters and deduped with a -2, -3
/// suffix if a document contains a re-test), since it's unvalidated OCR
/// output.
/// </summary>
public sealed class BloodworkResultEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty;
    public string RowKey { get; set; } = string.Empty;
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string Analyse { get; set; } = string.Empty;
    public string Bezeichnung { get; set; } = string.Empty;

    /// <summary>Kept as a string, not a numeric type -- some cells are non-numeric ("positiv", "&lt;0.1").</summary>
    public string Ergebniswert { get; set; } = string.Empty;

    public string Flag { get; set; } = string.Empty;
    public string Einheit { get; set; } = string.Empty;
    public string Ergebnistext { get; set; } = string.Empty;
    public string Normbereich { get; set; } = string.Empty;

    /// <summary>Links back to the owning bloodworkJobs.RowKey.</summary>
    public string SourceDocumentId { get; set; } = string.Empty;

    /// <summary>ISO 8601.</summary>
    public string ExtractedAt { get; set; } = string.Empty;

    public bool Corrected { get; set; }

    /// <summary>ISO 8601. Set alongside Corrected by the correction endpoint.</summary>
    public string? CorrectedAt { get; set; }
}
