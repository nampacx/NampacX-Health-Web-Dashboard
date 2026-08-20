using System.Text.Json;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Queues;
using Bloodwork.Models;
using Bloodwork.Models.Exceptions;
using Bloodwork.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace Bloodwork.Functions;

public sealed class UploadFunction(
    BloodworkOptions options,
    BlobContainerClient documentsContainer,
    QueueClient processingQueue,
    JobsRepository jobsRepository)
{
    private static readonly IReadOnlyDictionary<string, string> AllowedContentTypes = new Dictionary<string, string>
    {
        ["application/pdf"] = ".pdf",
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
    };

    [Function("BloodworkUpload")]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", "options", Route = "bloodwork/upload")] HttpRequest req,
        FunctionContext context,
        CancellationToken ct)
    {
        var contentType = req.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
        if (contentType is null || !AllowedContentTypes.TryGetValue(contentType, out var extension))
        {
            throw new UnsupportedMediaTypeException(
                $"Unsupported Content-Type: {contentType ?? "(none)"}");
        }

        if (req.ContentLength is { } declaredLength && declaredLength > options.MaxUploadBytes)
        {
            throw new PayloadTooLargeException("File exceeds the upload size limit.");
        }

        await using var buffer = new MemoryStream();
        await req.Body.CopyToAsync(buffer, ct);
        if (buffer.Length > options.MaxUploadBytes)
        {
            throw new PayloadTooLargeException("File exceeds the upload size limit.");
        }
        buffer.Position = 0;

        var documentId = Guid.NewGuid().ToString();
        var blobName = documentId + extension;

        await documentsContainer.GetBlobClient(blobName).UploadAsync(
            buffer,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } },
            ct);

        await jobsRepository.CreateAsync(documentId, blobName, contentType, CallerContext.RequireGoogleSub(context), ct);

        var message = JsonSerializer.Serialize(new ProcessingMessage(documentId, blobName));
        await processingQueue.SendMessageAsync(message, ct);

        return new ObjectResult(new { documentId }) { StatusCode = StatusCodes.Status202Accepted };
    }
}
