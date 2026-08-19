using Azure;
using Azure.AI.DocumentIntelligence;

namespace Bloodwork.Services;

/// <summary>
/// Thin wrapper over DocumentIntelligenceClient's prebuilt-layout model --
/// exists so ProcessDocumentFunction depends on an injectable, mockable
/// service rather than the sealed SDK client type directly.
/// </summary>
public sealed class DocumentIntelligenceService(DocumentIntelligenceClient client)
{
    private const string LayoutModelId = "prebuilt-layout";

    public async Task<AnalyzeResult> AnalyzeLayoutAsync(BinaryData documentBytes, CancellationToken ct = default)
    {
        Operation<AnalyzeResult> operation =
            await client.AnalyzeDocumentAsync(WaitUntil.Completed, LayoutModelId, documentBytes, ct);
        return operation.Value;
    }
}
