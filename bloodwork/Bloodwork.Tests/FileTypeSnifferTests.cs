using System.Text;
using Bloodwork.Services;
using Xunit;

namespace Bloodwork.Tests;

public class FileTypeSnifferTests
{
    private static byte[] Head(params byte[] bytes) => bytes;

    [Fact]
    public void Matches_PdfBytesDeclaredAsPdf_IsTrue()
    {
        Assert.True(FileTypeSniffer.Matches("application/pdf", Encoding.ASCII.GetBytes("%PDF-1.7")));
    }

    [Fact]
    public void Matches_PngBytesDeclaredAsPng_IsTrue()
    {
        Assert.True(FileTypeSniffer.Matches("image/png", Head(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)));
    }

    [Theory]
    // JFIF, Exif and a bare SOI-plus-marker all start the same three bytes. The
    // fourth byte is where they differ, which is exactly why it is not checked.
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 })]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xE1 })]
    [InlineData(new byte[] { 0xFF, 0xD8, 0xFF, 0xDB })]
    public void Matches_JpegVariantsDeclaredAsJpeg_AreAllAccepted(byte[] head)
    {
        Assert.True(FileTypeSniffer.Matches("image/jpeg", head));
    }

    [Fact]
    public void Matches_PngBytesDeclaredAsPdf_IsFalse()
    {
        // The whole point: the header used to decide both the stored extension
        // and the blob's recorded content type, on the uploader's word alone.
        Assert.False(FileTypeSniffer.Matches("application/pdf", Head(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)));
    }

    [Fact]
    public void Matches_ExecutableDeclaredAsPng_IsFalse()
    {
        Assert.False(FileTypeSniffer.Matches("image/png", Encoding.ASCII.GetBytes("MZ\0\0\0\0")));
    }

    [Fact]
    public void Matches_TruncatedPngSignature_IsFalse()
    {
        // A file shorter than the signature cannot match it. StartsWith on a
        // shorter span is false rather than an out-of-range read.
        Assert.False(FileTypeSniffer.Matches("image/png", Head(0x89, 0x50, 0x4E)));
    }

    [Fact]
    public void Matches_EmptyBody_IsFalse()
    {
        Assert.False(FileTypeSniffer.Matches("application/pdf", []));
    }

    [Fact]
    public void Matches_ContentTypeItDoesNotKnow_IsFalseNotSkipped()
    {
        // Fails closed. A type added to UploadFunction's allowlist but not here
        // must be rejected rather than waved through unchecked.
        Assert.False(FileTypeSniffer.Matches("image/gif", Encoding.ASCII.GetBytes("GIF89a\0\0")));
    }
}
