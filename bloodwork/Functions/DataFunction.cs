using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace Bloodwork.Functions;

public sealed class DataFunction(BloodworkOptions options, ResultsRepository resultsRepository)
{
    [Function("BloodworkData")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "bloodwork/data")] HttpRequest req,
        FunctionContext context,
        CancellationToken ct)
    {
        // Both optional and both inclusive. Absent means "as far back as there
        // is", which is what this route always did -- narrowing is the caller's
        // to ask for, and MaxResultRows is what stops the answer growing without
        // bound when they don't.
        var from = ParseDate(req.Query["from"], "from");
        var to = ParseDate(req.Query["to"], "to");
        if (from is { } start && to is { } end && start > end)
        {
            throw new BadRequestException("'from' must not be later than 'to'.");
        }

        var page = await resultsRepository.ListForOwnerAsync(
            CallerContext.RequireGoogleSub(context), from, to, options.MaxResultRows, ct);

        // Grouped by report date, not returned as a flat
        // array of {date, entries} groups: the date string round-trips
        // straight into PUT /bloodwork/data/{date}/{analyte}, and the SPA
        // can build a timeline with Object.keys(data).sort() with no extra
        // find-by-date step.
        var grouped = new Dictionary<string, List<object>>();

        foreach (var entity in page.Rows)
        {
            // ReportDate, not PartitionKey: the partition is the caller's own
            // subject id now, and the date rides in the row's own column (and in
            // its RowKey prefix) instead.
            if (!grouped.TryGetValue(entity.ReportDate, out var entries))
            {
                entries = [];
                grouped[entity.ReportDate] = entries;
            }

            entries.Add(new
            {
                // The analyte half of the RowKey, not Analyse: they diverge
                // whenever Analyse needed sanitizing or deduping (see
                // ResultsRepository.MakeUniqueAnalyteKey), and this is what PUT
                // /bloodwork/data/{date}/{analyte} actually matches on -- callers
                // must round-trip this, not analyse. The date half is stripped
                // because it already travels as its own path segment.
                rowKey = ResultsRepository.AnalyteKeyOf(entity.RowKey),
                analyse = entity.Analyse,
                bezeichnung = entity.Bezeichnung,
                ergebniswert = entity.Ergebniswert,
                flag = entity.Flag,
                einheit = entity.Einheit,
                ergebnistext = entity.Ergebnistext,
                normbereich = entity.Normbereich,
                sourceDocumentId = entity.SourceDocumentId,
                corrected = entity.Corrected,
                correctedAt = entity.CorrectedAt,
            });
        }

        // An envelope rather than the bare map this used to return, so that
        // `truncated` has somewhere to live. A capped response that looked
        // identical to a complete one would read as "these are all my results"
        // while quietly being the recent end of them.
        return new OkObjectResult(new { results = grouped, truncated = page.Truncated });
    }

    /// <summary>
    /// Strict ISO YYYY-MM-DD, because that is exactly what the RowKey prefix is:
    /// a laxer parse would accept a form that formats back into a different
    /// string and silently select the wrong range.
    /// </summary>
    private static DateOnly? ParseDate(string? value, string parameterName)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        if (!DateOnly.TryParseExact(value.Trim(), "yyyy-MM-dd", out var parsed))
        {
            throw new BadRequestException($"'{parameterName}' must be an ISO date (YYYY-MM-DD).");
        }
        return parsed;
    }
}
