namespace Bloodwork.Models;

/// <summary>The queue message UploadFunction enqueues and ProcessDocumentFunction consumes.</summary>
public sealed record ProcessingMessage(string DocumentId, string BlobName);
