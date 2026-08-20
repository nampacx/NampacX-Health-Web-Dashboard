using Azure;
using Azure.Data.Tables;

namespace Bloodwork.Models;

/// <summary>
/// A row in the <c>bloodworkResults</c> table -- one per analyte per report.
///
/// <b>PartitionKey is the owner's Google subject id.</b> RowKey is
/// <c>{reportDate}|{analyteCode}</c>: the report date (ISO YYYY-MM-DD, taken
/// from "vom DD.MM.YYYY" in the document, not the "Datum:" print date), then the
/// lab's own short analyte code from the "Analyse" column (sanitized against
/// Table Storage's forbidden RowKey characters and deduped with a -2, -3 suffix
/// if a document contains a re-test), since it's unvalidated OCR output.
///
/// The owner has to be in the key. Rows used to be keyed (reportDate, analyte)
/// with <see cref="Sub"/> as an ordinary column, which read correctly -- every
/// list and lookup filtered on it -- but did not <i>write</i> correctly: the
/// upsert in <see cref="Bloodwork.Services.ResultsRepository.WriteRowsAsync"/>
/// matched on date and analyte alone, so any two accounts holding a report from
/// the same day silently overwrote each other on every shared lab code, owner
/// included. Lab codes are shared across every patient of a lab and report dates
/// cluster on weekdays, so that was an ordinary accident, not just an attack.
/// Keying by owner makes the collision unrepresentable rather than guarded
/// against, and turns the per-caller listing into a single-partition read.
/// </summary>
public sealed class BloodworkResultEntity : ITableEntity
{
    public string PartitionKey { get; set; } = string.Empty;
    public string RowKey { get; set; } = string.Empty;
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    /// <summary>
    /// ISO YYYY-MM-DD, the same value the RowKey is prefixed with. Denormalized
    /// for the same reason <see cref="Sub"/> is: DataFunction groups every row by
    /// report date on every request, and that should be a property read rather
    /// than a string split. Written once, alongside the RowKey it mirrors.
    /// </summary>
    public string ReportDate { get; set; } = string.Empty;

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

    /// <summary>
    /// The uploader's Google subject id, copied from the owning job at write
    /// time. Now equal to <see cref="PartitionKey"/>, and kept alongside it
    /// deliberately: CorrectAsync still asserts ownership at the point of
    /// mutation, so the write stays guarded even though the partition already
    /// scopes the read that precedes it.
    /// </summary>
    public string Sub { get; set; } = string.Empty;

    /// <summary>ISO 8601.</summary>
    public string ExtractedAt { get; set; } = string.Empty;

    public bool Corrected { get; set; }

    /// <summary>ISO 8601. Set alongside Corrected by the correction endpoint.</summary>
    public string? CorrectedAt { get; set; }
}
