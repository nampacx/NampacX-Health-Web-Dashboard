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

    public async Task WriteRowsAsync(string reportDate, IReadOnlyList<AnalyteRow> rows, string sourceDocumentId, CancellationToken ct = default)
    {
        var extractedAt = DateTimeOffset.UtcNow.ToString("O");
        var seenRowKeys = new HashSet<string>(StringComparer.Ordinal);

        foreach (var row in rows)
        {
            var rowKey = MakeUniqueRowKey(row.Analyse, seenRowKeys);
            var entity = new BloodworkResultEntity
            {
                PartitionKey = reportDate,
                RowKey = rowKey,
                Analyse = row.Analyse,
                Bezeichnung = row.Bezeichnung,
                Ergebniswert = row.Ergebniswert,
                Flag = row.Flag,
                Einheit = row.Einheit,
                Ergebnistext = row.Ergebnistext,
                Normbereich = row.Normbereich,
                SourceDocumentId = sourceDocumentId,
                ExtractedAt = extractedAt,
                Corrected = false,
            };
            await table.UpsertEntityAsync(entity, TableUpdateMode.Replace, ct);
        }
    }

    public async IAsyncEnumerable<BloodworkResultEntity> ListAllAsync([System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct = default)
    {
        await foreach (var entity in table.QueryAsync<BloodworkResultEntity>(cancellationToken: ct))
        {
            yield return entity;
        }
    }

    public async Task<BloodworkResultEntity> CorrectAsync(
        string reportDate, string analyte, IReadOnlyDictionary<string, string> patch, CancellationToken ct = default)
    {
        BloodworkResultEntity entity;
        try
        {
            var response = await table.GetEntityAsync<BloodworkResultEntity>(reportDate, analyte, cancellationToken: ct);
            entity = response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
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
    /// so sanitize defensively rather than trust it. A repeated code within
    /// one document (e.g. a re-test) gets a #2, #3 suffix rather than
    /// silently overwriting the earlier value.
    /// </summary>
    private static string MakeUniqueRowKey(string analyse, HashSet<string> seen)
    {
        var forbidden = new[] { '/', '\\', '#', '?' };
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
            candidate = sanitized + "#" + suffix;
            suffix++;
        }
        return candidate;
    }
}
