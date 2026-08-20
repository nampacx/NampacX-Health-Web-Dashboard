using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Microsoft.Extensions.DependencyInjection;

namespace Bloodwork.Services;

public sealed class JobsRepository([FromKeyedServices("jobs")] TableClient table)
{
    private const string PartitionKey = "job";

    public async Task CreateAsync(string documentId, string blobName, string contentType, string sub, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow.ToString("O");
        var entity = new BloodworkJobEntity
        {
            PartitionKey = PartitionKey,
            RowKey = documentId,
            Status = "pending",
            BlobName = blobName,
            ContentType = contentType,
            Sub = sub,
            CreatedAt = now,
            UpdatedAt = now,
        };
        await table.AddEntityAsync(entity, ct);
    }

    public async Task<BloodworkJobEntity> GetAsync(string documentId, CancellationToken ct = default)
    {
        try
        {
            var response = await table.GetEntityAsync<BloodworkJobEntity>(PartitionKey, documentId, cancellationToken: ct);
            return response.Value;
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new NotFoundException($"No upload found with id '{documentId}'.");
        }
    }

    public Task<BloodworkJobEntity> MarkProcessingAsync(string documentId, CancellationToken ct = default) =>
        UpdateAsync(documentId, entity => entity.Status = "processing", ct);

    public Task MarkCompletedAsync(string documentId, string reportDate, int rowCount, CancellationToken ct = default) =>
        UpdateAsync(documentId, entity =>
        {
            entity.Status = "completed";
            entity.ReportDate = reportDate;
            entity.RowCount = rowCount;
        }, ct);

    /// <summary>
    /// Both halves are required, so a caller cannot record a failure without
    /// deciding what is safe to show for it. <paramref name="errorMessage"/> is
    /// returned to the caller verbatim and rendered -- it must be text this app
    /// wrote, never an exception's own.
    /// </summary>
    public Task MarkFailedAsync(string documentId, string errorCode, string errorMessage, CancellationToken ct = default) =>
        UpdateAsync(documentId, entity =>
        {
            entity.Status = "failed";
            entity.ErrorCode = errorCode;
            entity.ErrorMessage = errorMessage;
        }, ct);

    /// <summary>
    /// Deletes one job row, but only if it belongs to <paramref name="sub"/>, and
    /// returns the blob it was tracking so the caller can delete that too.
    ///
    /// Null for a job that does not exist <i>or</i> belongs to someone else -- the
    /// same answer for both, matching JobStatusFunction: confirming a job exists
    /// under another account is its own information leak, and a deletion that
    /// reported "not yours" rather than "not there" would be an existence oracle
    /// requiring nothing but a guessed GUID.
    /// </summary>
    public async Task<string?> DeleteOwnedAsync(string documentId, string sub, CancellationToken ct = default)
    {
        BloodworkJobEntity job;
        try
        {
            job = await GetAsync(documentId, ct);
        }
        catch (NotFoundException)
        {
            return null;
        }

        if (!string.Equals(job.Sub, sub, StringComparison.Ordinal))
        {
            return null;
        }

        // The ETag the row was read with, not ETag.All: if the processor updated
        // the job between the read and here, this fails rather than deleting a row
        // that has since changed underneath it.
        await table.DeleteEntityAsync(PartitionKey, documentId, job.ETag, ct);
        return job.BlobName;
    }

    private async Task<BloodworkJobEntity> UpdateAsync(string documentId, Action<BloodworkJobEntity> mutate, CancellationToken ct)
    {
        var entity = await GetAsync(documentId, ct);
        mutate(entity);
        entity.UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
        await table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace, ct);
        return entity;
    }
}
