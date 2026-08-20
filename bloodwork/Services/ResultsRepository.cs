using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Microsoft.Extensions.DependencyInjection;

namespace Bloodwork.Services;

public sealed class ResultsRepository([FromKeyedServices("results")] TableClient table)
{
    /// <summary>Fields a caller is allowed to correct via PUT /bloodwork/data/{date}/{analyte}.
    /// Not Analyse (the row's own identity/RowKey) or Bezeichnung (the lab's own label,
    /// treated as identifying metadata, not a measured value).</summary>
    public static readonly IReadOnlyCollection<string> CorrectableFields =
        ["ergebniswert", "flag", "einheit", "ergebnistext", "normbereich"];

    /// <summary>
    /// Separates the report date from the analyte code inside a RowKey.
    ///
    /// Splitting on the FIRST occurrence is unambiguous in both directions: the
    /// date half is ISO YYYY-MM-DD and cannot contain this character, and
    /// <see cref="MakeUniqueAnalyteKey"/> strips it out of the analyte half.
    /// '|' is legal in a Table Storage key (only '/', '\', '#', '?' and control
    /// characters are not), so it needs no escaping of its own.
    /// </summary>
    private const char RowKeySeparator = '|';

    /// <summary>
    /// The row's identity within its owner's partition. The report date has to be
    /// part of it because the partition is now one caller's entire history rather
    /// than a single report -- without the date, every report a person ever
    /// uploaded would collide on the analyte code alone.
    /// </summary>
    public static string MakeRowKey(string reportDate, string analyteKey) =>
        reportDate + RowKeySeparator + analyteKey;

    /// <summary>
    /// The analyte half of a RowKey. This is what the API hands back to callers as
    /// <c>rowKey</c> and what PUT /bloodwork/data/{date}/{analyte} takes in its
    /// route, so the public contract is unchanged by the storage layout: the date
    /// already travels as its own path segment and does not need repeating inside
    /// the second one.
    /// </summary>
    public static string AnalyteKeyOf(string rowKey)
    {
        var separator = rowKey.IndexOf(RowKeySeparator);
        return separator < 0 ? rowKey : rowKey[(separator + 1)..];
    }

    public async Task WriteRowsAsync(string reportDate, IReadOnlyList<AnalyteRow> rows, string sourceDocumentId, string sub, CancellationToken ct = default)
    {
        var extractedAt = DateTimeOffset.UtcNow.ToString("O");
        var seenAnalyteKeys = new HashSet<string>(StringComparer.Ordinal);

        foreach (var row in rows)
        {
            var analyteKey = MakeUniqueAnalyteKey(row.Analyse, seenAnalyteKeys);
            var entity = new BloodworkResultEntity
            {
                // The owner IS the partition. Before this, rows were keyed
                // (reportDate, analyte) with the owner as an ordinary column, so
                // two accounts holding a report from the same day collided on the
                // shared lab code -- and this Upsert silently replaced the earlier
                // row, owner included. See the type's own comment.
                PartitionKey = sub,
                RowKey = MakeRowKey(reportDate, analyteKey),
                ReportDate = reportDate,
                Analyse = row.Analyse,
                Bezeichnung = row.Bezeichnung,
                Ergebniswert = row.Ergebniswert,
                Flag = row.Flag,
                Einheit = row.Einheit,
                Ergebnistext = row.Ergebnistext,
                Normbereich = row.Normbereich,
                SourceDocumentId = sourceDocumentId,
                Sub = sub,
                ExtractedAt = extractedAt,
                Corrected = false,
            };
            await table.UpsertEntityAsync(entity, TableUpdateMode.Replace, ct);
        }
    }

    public async IAsyncEnumerable<BloodworkResultEntity> ListForOwnerAsync(
        string sub, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        // A single-partition query, not a filter on a non-key property: a caller
        // owns exactly one partition, so this reads their rows and nobody else's.
        // The previous form (e.Sub == sub) was a full-table scan whose cost grew
        // with every user's data rather than the caller's.
        await foreach (var entity in table.QueryAsync<BloodworkResultEntity>(e => e.PartitionKey == sub, cancellationToken: ct))
        {
            yield return entity;
        }
    }

    public async Task<BloodworkResultEntity> CorrectAsync(
        string reportDate, string analyte, string sub, IReadOnlyDictionary<string, string> patch, CancellationToken ct = default)
    {
        BloodworkResultEntity entity;
        try
        {
            var response = await table.GetEntityAsync<BloodworkResultEntity>(sub, MakeRowKey(reportDate, analyte), cancellationToken: ct);
            entity = response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new NotFoundException($"No result found for analyte '{analyte}' on {reportDate}.");
        }

        // Belt and braces. The partition key above already scopes the lookup to
        // the caller, so another account's row can no longer be reached here at
        // all -- but ownership stays asserted at the point of mutation, so this
        // keeps protecting the write if the key layout is ever revisited. Same
        // message as the row-not-found case above either way: confirming a row
        // exists under someone else's account is its own information leak.
        if (!string.Equals(entity.Sub, sub, StringComparison.Ordinal))
        {
            throw new NotFoundException($"No result found for analyte '{analyte}' on {reportDate}.");
        }

        foreach (var (field, value) in patch)
        {
            switch (field)
            {
                case "ergebniswert": entity.Ergebniswert = value; break;
                case "flag": entity.Flag = value; break;
                case "einheit": entity.Einheit = value; break;
                case "ergebnistext": entity.Ergebnistext = value; break;
                case "normbereich": entity.Normbereich = value; break;
            }
        }
        entity.Corrected = true;
        entity.CorrectedAt = DateTimeOffset.UtcNow.ToString("O");

        await table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Merge, ct);
        return entity;
    }

    /// <summary>
    /// Table Storage RowKeys can't contain a forward slash, backslash, hash,
    /// question mark, or control characters; this is unvalidated OCR output,
    /// so sanitize defensively rather than trust it. <see cref="RowKeySeparator"/>
    /// goes too, so the date/analyte split stays unambiguous. A repeated code
    /// within one document (e.g. a re-test) gets a -2, -3 suffix rather than
    /// silently overwriting the earlier value -- '-' rather than '#' since
    /// '#' is itself one of the characters just sanitized out above.
    ///
    /// Deduping within the document is enough: one document carries one report
    /// date, so a unique analyte key there is a unique RowKey once the date is
    /// prefixed.
    /// </summary>
    private static string MakeUniqueAnalyteKey(string analyse, HashSet<string> seen)
    {
        var forbidden = new[] { '/', '\\', '#', '?', RowKeySeparator };
        var chars = analyse
            .Select(c => char.IsControl(c) || forbidden.Contains(c) ? '_' : c)
            .ToArray();
        var sanitized = new string(chars).Trim();
        if (sanitized.Length == 0)
        {
            sanitized = "UNKNOWN";
        }

        var candidate = sanitized;
        var suffix = 2;
        while (!seen.Add(candidate))
        {
            candidate = sanitized + "-" + suffix;
            suffix++;
        }
        return candidate;
    }
}
