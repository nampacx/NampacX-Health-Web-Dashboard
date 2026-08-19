using System.Text.Json;
using Azure.Storage.Blobs;
using Azure.Storage.Queues.Models;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Bloodwork.Functions;

public sealed class ProcessDocumentFunction(
    BlobContainerClient documentsContainer,
    JobsRepository jobsRepository,
    ResultsRepository resultsRepository,
    DocumentIntelligenceService documentIntelligence,
    LayoutParser layoutParser,
    ILogger<ProcessDocumentFunction> logger)
{
    // Must match host.json's extensions.queues.maxDequeueCount -- the two
    // are tied together by this comment rather than a shared constant,
    // since one lives in code and the other in host config.
    private const int MaxDequeueCount = 5;

    [Function("ProcessDocument")]
    public async Task Run(
        [QueueTrigger("bloodwork-processing", Connection = "AzureWebJobsStorage")] QueueMessage queueMessage,
        CancellationToken ct)
    {
        ProcessingMessage? payload;
        try
        {
            payload = JsonSerializer.Deserialize<ProcessingMessage>(queueMessage.MessageText);
        }
        catch (JsonException ex)
        {
            // A malformed queue message can never be fixed by retrying it.
            logger.LogError(ex, "Could not parse queue message, dropping it.");
            return;
        }

        if (payload is null)
        {
            logger.LogError("Empty queue message, dropping it.");
            return;
        }

        try
        {
            await jobsRepository.MarkProcessingAsync(payload.DocumentId, ct);

            var download = await documentsContainer.GetBlobClient(payload.BlobName).DownloadContentAsync(ct);
            var analyzeResult = await documentIntelligence.AnalyzeLayoutAsync(download.Value.Content, ct);
            var (reportDate, rows) = layoutParser.Parse(analyzeResult);

            await resultsRepository.WriteRowsAsync(reportDate, rows, payload.DocumentId, ct);
            await jobsRepository.MarkCompletedAsync(payload.DocumentId, reportDate, rows.Count, ct);
        }
        catch (ParseException ex)
        {
            // Permanent -- a header row or report date that was never there
            // will not appear on a retry. Mark failed immediately and let
            // the message be deleted normally.
            logger.LogError(ex, "Permanent parse failure for document {DocumentId} ({Code})", payload.DocumentId, ex.Code);
            await jobsRepository.MarkFailedAsync(payload.DocumentId, ex.Message, ct);
        }
        catch (Exception ex)
        {
            // Transient (Document Intelligence throttling/5xx, storage
            // timeouts). Only mark the job failed on the final attempt;
            // otherwise rethrow so the queue extension's built-in retry
            // handles it, leaving the job's status as "processing" in the
            // meantime rather than prematurely "failed".
            logger.LogError(ex, "Attempt {DequeueCount} failed for document {DocumentId}", queueMessage.DequeueCount, payload.DocumentId);
            if (queueMessage.DequeueCount >= MaxDequeueCount)
            {
                await jobsRepository.MarkFailedAsync(
                    payload.DocumentId,
                    $"Gave up after {queueMessage.DequeueCount} attempts: {ex.Message}",
                    ct);
                return;
            }
            throw;
        }
    }
}
