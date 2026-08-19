using Azure;
using Azure.AI.DocumentIntelligence;
using Azure.Data.Tables;
using Azure.Identity;
using Azure.Storage.Blobs;
using Azure.Storage.Queues;
using Bloodwork.Middleware;
using Bloodwork.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.ApplicationInsights;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = FunctionsApplication.CreateBuilder(args);

// Enables HttpRequest/IActionResult (ASP.NET Core integration) instead of the
// built-in HttpRequestData/HttpResponseData model.
builder.ConfigureFunctionsWebApplication();

builder.Services.ConfigureFunctionsApplicationInsights();

// Loaded once, eagerly, at startup -- an invalid deployment fails to start at
// all rather than accepting requests and 500ing each one. This is the .NET
// isolated-worker equivalent of broker's "fail loudly" loadConfig() posture.
var options = BloodworkOptions.Load(builder.Configuration);
builder.Services.AddSingleton(options);

builder.Services.AddHttpClient<GoogleTokenVerifier>();
builder.Services.AddSingleton<CorsService>();
builder.Services.AddSingleton<LayoutParser>();
builder.Services.AddScoped<JobsRepository>();
builder.Services.AddScoped<ResultsRepository>();
builder.Services.AddScoped<DocumentIntelligenceService>();

// Storage clients: connection string locally (Azurite), account URL +
// DefaultAzureCredential in Azure via the Function App's own system-assigned
// managed identity. QueueMessageEncoding.None keeps queue messages as plain
// JSON text, matching what the [QueueTrigger] string parameter expects.
builder.Services.AddSingleton(sp =>
{
    var o = sp.GetRequiredService<BloodworkOptions>();
    return o.StorageConnectionString is { Length: > 0 } cs
        ? new BlobServiceClient(cs)
        : new BlobServiceClient(new Uri($"https://{o.StorageAccountName}.blob.core.windows.net"), new DefaultAzureCredential());
});
builder.Services.AddSingleton(sp =>
{
    var o = sp.GetRequiredService<BloodworkOptions>();
    return o.StorageConnectionString is { Length: > 0 } cs
        ? new TableServiceClient(cs)
        : new TableServiceClient(new Uri($"https://{o.StorageAccountName}.table.core.windows.net"), new DefaultAzureCredential());
});
builder.Services.AddSingleton(sp =>
{
    var o = sp.GetRequiredService<BloodworkOptions>();
    var queueOptions = new QueueClientOptions { MessageEncoding = QueueMessageEncoding.None };
    return o.StorageConnectionString is { Length: > 0 } cs
        ? new QueueServiceClient(cs, queueOptions)
        : new QueueServiceClient(new Uri($"https://{o.StorageAccountName}.queue.core.windows.net"), new DefaultAzureCredential(), queueOptions);
});
builder.Services.AddSingleton(sp =>
{
    var o = sp.GetRequiredService<BloodworkOptions>();
    var endpoint = new Uri(o.DocumentIntelligenceEndpoint);
    return o.DocumentIntelligenceKey is { Length: > 0 } key
        ? new DocumentIntelligenceClient(endpoint, new AzureKeyCredential(key))
        : new DocumentIntelligenceClient(endpoint, new DefaultAzureCredential());
});

// Table/container/queue names are decided here, once, rather than scattered
// as string literals across repositories and functions. Locally, against
// Azurite, none of these pre-exist the way Bicep provisions them in Azure --
// CreateIfNotExists makes local dev work with just `npx azurite` and no
// separate setup step.
builder.Services.AddKeyedSingleton("jobs", (sp, _) =>
{
    var client = sp.GetRequiredService<TableServiceClient>().GetTableClient("bloodworkJobs");
    client.CreateIfNotExists();
    return client;
});
builder.Services.AddKeyedSingleton("results", (sp, _) =>
{
    var client = sp.GetRequiredService<TableServiceClient>().GetTableClient("bloodworkResults");
    client.CreateIfNotExists();
    return client;
});
builder.Services.AddSingleton(sp =>
{
    var client = sp.GetRequiredService<BlobServiceClient>().GetBlobContainerClient("bloodwork-documents");
    client.CreateIfNotExists();
    return client;
});
builder.Services.AddSingleton(sp =>
{
    var client = sp.GetRequiredService<QueueServiceClient>().GetQueueClient("bloodwork-processing");
    client.CreateIfNotExists();
    return client;
});

// Registration order is the wrapping order: the first-registered middleware
// is outermost. ErrorHandlingMiddleware must be registered FIRST so it also
// catches exceptions thrown by GoogleAuthMiddleware (a 401/502 from a bad or
// unreachable Google token must still come back as the standard {error,
// message} JSON body, not an unhandled-exception 500).
builder.UseMiddleware<ErrorHandlingMiddleware>();
builder.UseWhen<GoogleAuthMiddleware>(IsHttpTrigger);

builder.Build().Run();

// The queue-triggered document processor has no caller to authenticate --
// only HTTP-triggered functions require a Google Bearer token.
static bool IsHttpTrigger(FunctionContext context) =>
    context.FunctionDefinition.InputBindings.Values.Any(b => b.Type == "httpTrigger");
