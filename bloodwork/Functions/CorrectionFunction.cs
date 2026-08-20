using System.Text.Json;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace Bloodwork.Functions;

public sealed class CorrectionFunction(ResultsRepository resultsRepository, CallerContext callerContext)
{
    [Function("BloodworkCorrection")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", "options", Route = "bloodwork/data/{date}/{analyte}")] HttpRequest req,
        string date,
        string analyte,
        CancellationToken ct)
    {
        Dictionary<string, string>? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync<Dictionary<string, string>>(req.Body, cancellationToken: ct);
        }
        catch (JsonException)
        {
            throw new BadRequestException("Request body is not valid JSON.");
        }

        // Whitelisted: never Analyse (the row's own identity) or Bezeichnung
        // (the lab's own label, treated as identifying metadata, not a
        // measured value).
        var patch = (body ?? [])
            .Where(kv => ResultsRepository.CorrectableFields.Contains(kv.Key))
            .ToDictionary(kv => kv.Key, kv => kv.Value);

        if (patch.Count == 0)
        {
            throw new BadRequestException("No correctable fields supplied.");
        }

        var updated = await resultsRepository.CorrectAsync(date, analyte, callerContext.RequireGoogleSub(), patch, ct);

        return new OkObjectResult(new
        {
            rowKey = updated.RowKey,
            analyse = updated.Analyse,
            bezeichnung = updated.Bezeichnung,
            ergebniswert = updated.Ergebniswert,
            flag = updated.Flag,
            einheit = updated.Einheit,
            ergebnistext = updated.Ergebnistext,
            normbereich = updated.Normbereich,
            sourceDocumentId = updated.SourceDocumentId,
            corrected = updated.Corrected,
            correctedAt = updated.CorrectedAt,
        });
    }
}
