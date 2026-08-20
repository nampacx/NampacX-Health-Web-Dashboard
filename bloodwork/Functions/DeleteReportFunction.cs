using Azure.Storage.Blobs;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Bloodwork.Functions;

/// <summary>
/// Erases one report: its extracted rows, the job rows that produced them, and
/// the uploaded documents themselves.
///
/// This exists because until now nothing in the app could remove anything.
/// Uploaded lab reports -- full PDFs and scans carrying a name, a date of birth
/// and a complete result set -- accumulated in blob storage indefinitely,
/// including for jobs that failed, with no endpoint to delete them and no
/// lifecycle rule to expire them. For special-category health data under GDPR
/// Art. 9 that is both a steadily growing breach surface and a plain erasure
/// gap. The blob lifecycle rule in infra/main.bicep handles the passage of time;
/// this handles the user actually asking.
///
/// Order matters on failure. Result rows go first, then the blob, then the job
/// row -- so a failure part-way through leaves strictly less data than it
/// started with, never a report that has lost its rows but kept its scan. The
/// route is idempotent in the same spirit: deleting a date that is already gone
/// is a 404, and re-running a partial delete finishes it.
/// </summary>
public sealed class DeleteReportFunction(
    ResultsRepository resultsRepository,
    JobsRepository jobsRepository,
    BlobContainerClient documentsContainer,
    ILogger<DeleteReportFunction> logger)
{
    [Function("BloodworkDeleteReport")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", "options", Route = "bloodwork/data/{date}")] HttpRequest req,
        string date,
        FunctionContext context,
        CancellationToken ct)
    {
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", out var reportDate))
        {
            throw new BadRequestException("Report date must be an ISO date (YYYY-MM-DD).");
        }

        var sub = CallerContext.RequireGoogleSub(context);
        var deleted = await resultsRepository.DeleteReportAsync(sub, reportDate, ct);

        if (deleted.RowCount == 0)
        {
            // Same 404 a date that never existed gets. The query above ran inside
            // the caller's own partition, so "no rows" cannot distinguish an
            // unknown date from another account's report in the first place.
            throw new NotFoundException($"No report found for {date}.");
        }

        foreach (var documentId in deleted.SourceDocumentIds)
        {
            var blobName = await jobsRepository.DeleteOwnedAsync(documentId, sub, ct);
            if (blobName is null)
            {
                // The job row is gone, or belongs to someone else. Nothing to
                // delete and nothing to report: the rows this call was actually
                // asked to erase are already gone.
                continue;
            }
            await documentsContainer.GetBlobClient(blobName).DeleteIfExistsAsync(cancellationToken: ct);
        }

        // The document id is deliberately absent from the log line: it is the id
        // of a medical document, and the row count is enough to reconcile a
        // deletion against.
        logger.LogInformation(
            "Deleted report {ReportDate}: {RowCount} rows, {DocumentCount} documents",
            date, deleted.RowCount, deleted.SourceDocumentIds.Count);

        return new NoContentResult();
    }
}
