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
        CancellationToken ct)
    {
        var job = await jobsRepository.GetAsync(documentId, ct);
        return new OkObjectResult(new
        {
            documentId = job.RowKey,
            status = job.Status,
            errorMessage = job.ErrorMessage,
            reportDate = job.ReportDate,
            rowCount = job.RowCount,
            createdAt = job.CreatedAt,
            updatedAt = job.UpdatedAt,
        });
    }
}
