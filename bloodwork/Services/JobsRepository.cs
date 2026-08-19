using Azure;
using Azure.Data.Tables;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Microsoft.Extensions.DependencyInjection;

namespace Bloodwork.Services;

public sealed class JobsRepository([FromKeyedServices("jobs")] TableClient table)
{
    private const string PartitionKey = "job";

    public async Task CreateAsync(string documentId, string blobName, string contentType, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow.ToString("O");
        var entity = new BloodworkJobEntity
        {
            PartitionKey = PartitionKey,
            RowKey = documentId,
            Status = "pending",
            BlobName = blobName,
            ContentType = contentType,
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

    public Task MarkProcessingAsync(string documentId, CancellationToken ct = default) =>
        UpdateAsync(documentId, entity => entity.Status = "processing", ct);

    public Task MarkCompletedAsync(string documentId, string reportDate, int rowCount, CancellationToken ct = default) =>
        UpdateAsync(documentId, entity =>
        {
            entity.Status = "completed";
            entity.ReportDate = reportDate;
            entity.RowCount = rowCount;
        }, ct);

    public Task MarkFailedAsync(string documentId, string errorMessage, CancellationToken ct = default) =>
        UpdateAsync(documentId, entity =>
        {
            entity.Status = "failed";
            entity.ErrorMessage = errorMessage;
        }, ct);

    private async Task UpdateAsync(string documentId, Action<BloodworkJobEntity> mutate, CancellationToken ct)
    {
        var entity = await GetAsync(documentId, ct);
        mutate(entity);
        entity.UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
        await table.UpdateEntityAsync(entity, entity.ETag, TableUpdateMode.Replace, ct);
    }
}
