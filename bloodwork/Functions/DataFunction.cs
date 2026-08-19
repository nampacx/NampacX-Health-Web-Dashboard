using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace Bloodwork.Functions;

public sealed class DataFunction(ResultsRepository resultsRepository)
{
    [Function("BloodworkData")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "bloodwork/data")] HttpRequest req,
        CancellationToken ct)
    {
        // Grouped by report date (PartitionKey), not returned as a flat
        // array of {date, entries} groups: the date string round-trips
        // straight into PUT /bloodwork/data/{date}/{analyte}, and the SPA
        // can build a timeline with Object.keys(data).sort() with no extra
        // find-by-date step.
        var grouped = new Dictionary<string, List<object>>();

        await foreach (var entity in resultsRepository.ListAllAsync(ct))
        {
            if (!grouped.TryGetValue(entity.PartitionKey, out var entries))
            {
                entries = [];
                grouped[entity.PartitionKey] = entries;
            }

            entries.Add(new
            {
                // RowKey, not Analyse: they diverge whenever Analyse needed
                // sanitizing or deduping (see ResultsRepository.MakeUniqueRowKey),
                // and RowKey is what PUT /bloodwork/data/{date}/{analyte} actually
                // matches on -- callers must round-trip this, not analyse.
                rowKey = entity.RowKey,
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

        return new OkObjectResult(grouped);
    }
}
