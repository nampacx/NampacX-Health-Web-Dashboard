namespace Bloodwork.Services;

/// <summary>
/// Cross-checks an upload's leading bytes against the <c>Content-Type</c> the
/// caller declared.
///
/// The header alone used to decide both the stored file's extension and the
/// blob's own recorded content type, which meant a stored blob's declared type
/// was whatever the uploader said it was. Nothing serves those blobs back to a
/// browser today and the container is private, so the impact was contained --
/// but the moment anyone adds a download route or hands out a SAS URL, a blob
/// labelled <c>image/png</c> that is really something else becomes a live
/// problem. Checking the first eight bytes costs nothing and removes the
/// question.
///
/// This is a consistency check, not a format validation: a file that starts with
/// <c>%PDF-</c> and is otherwise garbage still passes here and is still rejected
/// downstream by Document Intelligence. The point is only that the label and the
/// bytes agree.
/// </summary>
public static class FileTypeSniffer
{
    /// <summary>Longest signature below, and so the number of bytes worth reading.</summary>
    public const int MaxSignatureLength = 8;

    private static readonly byte[] Pdf = "%PDF-"u8.ToArray();

    /// <summary>The full 8-byte PNG signature, not just the "\x89PNG" prefix.</summary>
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>
    /// SOI plus the first marker byte. Deliberately three bytes and not four:
    /// the fourth distinguishes JFIF from Exif from the various camera variants,
    /// and pinning it would reject perfectly ordinary photographs.
    /// </summary>
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];

    /// <summary>
    /// False for any content type this app does not accept, so a type that is
    /// added to UploadFunction's allowlist without being added here fails closed
    /// rather than skipping the check.
    /// </summary>
    public static bool Matches(string contentType, ReadOnlySpan<byte> head) => contentType switch
    {
        "application/pdf" => head.StartsWith(Pdf),
        "image/png" => head.StartsWith(Png),
        "image/jpeg" => head.StartsWith(Jpeg),
        _ => false,
    };
}
