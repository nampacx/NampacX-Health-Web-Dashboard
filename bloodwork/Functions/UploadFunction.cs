using System.Buffers;
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

        // A declared length over the limit is refused without reading a byte.
        // It is only ever an optimisation, though: Content-Length is absent
        // entirely on a chunked request, which is exactly how an attacker would
        // send one. CopyBoundedAsync below is the check that actually holds.
        if (req.ContentLength is { } declaredLength && declaredLength > options.MaxUploadBytes)
        {
            throw new PayloadTooLargeException("File exceeds the upload size limit.");
        }

        // Sized from Content-Length where there is one. MemoryStream doubles its
        // capacity as it grows, so an unsized buffer near the limit transiently
        // holds roughly twice the file on the large object heap, per concurrent
        // request -- and this instance has 2048 MB for all of them.
        var capacity = req.ContentLength is { } length && length > 0 && length <= options.MaxUploadBytes
            ? (int)Math.Min(length, int.MaxValue)
            : 0;
        await using var buffer = new MemoryStream(capacity);

        // The signature is checked before the rest of the body is read, so a file
        // whose bytes contradict its Content-Type never gets buffered at all.
        var head = new byte[FileTypeSniffer.MaxSignatureLength];
        var headLength = await req.Body.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        if (!FileTypeSniffer.Matches(contentType, head.AsSpan(0, headLength)))
        {
            throw new UnsupportedMediaTypeException(
                $"File contents do not look like {contentType}.");
        }
        await buffer.WriteAsync(head.AsMemory(0, headLength), ct);

        await CopyBoundedAsync(req.Body, buffer, options.MaxUploadBytes - headLength, ct);
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

    /// <summary>
    /// Copies at most <paramref name="remainingBudget"/> further bytes, throwing
    /// the moment one more than that has been read.
    ///
    /// The difference from CopyToAsync plus a length check afterwards is where
    /// the limit binds: checking after the copy means the whole body is already
    /// in memory by the time it is refused, so MAX_UPLOAD_BYTES bounded nothing
    /// the worker allocated -- only the platform's own request cap did. Here
    /// nothing past the limit is ever buffered, whatever the caller declared.
    /// </summary>
    private static async Task CopyBoundedAsync(Stream source, Stream destination, long remainingBudget, CancellationToken ct)
    {
        var rented = ArrayPool<byte>.Shared.Rent(81920);
        try
        {
            while (true)
            {
                var read = await source.ReadAsync(rented, ct);
                if (read == 0)
                {
                    return;
                }

                remainingBudget -= read;
                if (remainingBudget < 0)
                {
                    throw new PayloadTooLargeException("File exceeds the upload size limit.");
                }

                await destination.WriteAsync(rented.AsMemory(0, read), ct);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(rented);
        }
    }
}
