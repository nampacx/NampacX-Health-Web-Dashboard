using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace Bloodwork.Functions;

public sealed class JobStatusFunction(JobsRepository jobsRepository)
{
    [Function("BloodworkJobStatus")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", "options", Route = "bloodwork/jobs/{documentId}")] HttpRequest req,
        string documentId,
        FunctionContext context,
        CancellationToken ct)
    {
        var job = await jobsRepository.GetAsync(documentId, ct);

        // Same "not found" a missing id gets -- confirming a job exists
        // under someone else's account is its own information leak.
        if (!string.Equals(job.Sub, CallerContext.RequireGoogleSub(context), StringComparison.Ordinal))
        {
            throw new NotFoundException($"No upload found with id '{documentId}'.");
        }

        return new OkObjectResult(new
        {
            documentId = job.RowKey,
            status = job.Status,
            errorCode = job.ErrorCode,
            errorMessage = job.ErrorMessage,
            reportDate = job.ReportDate,
            rowCount = job.RowCount,
            createdAt = job.CreatedAt,
            updatedAt = job.UpdatedAt,
        });
    }
}
