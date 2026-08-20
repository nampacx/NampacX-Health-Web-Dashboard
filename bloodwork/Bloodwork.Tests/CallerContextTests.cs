using Bloodwork.Services;
using Microsoft.Azure.Functions.Worker;
using Moq;
using Xunit;

namespace Bloodwork.Tests;

public class CallerContextTests
{
    // Regression coverage for a real production 500: a first version of this
    // hand-off used a DI-registered scoped service instead of
    // FunctionContext.Items, set by GoogleAuthMiddleware and read back via
    // constructor injection in the function. That shipped broken -- the
    // middleware and the function resolved different scope instances in
    // practice, so RequireGoogleSub always threw. Backing this with a real
    // FunctionContext.Items dictionary (not a mocked property) is the point:
    // it is the same mechanism the two real callers -- GoogleAuthMiddleware
    // and every HTTP-triggered function -- actually share.
    private static FunctionContext FakeContext()
    {
        var items = new Dictionary<object, object>();
        var context = new Mock<FunctionContext>();
        context.SetupProperty(c => c.Items, items);
        context.Object.Items = items;
        return context.Object;
    }

    [Fact]
    public void SetGoogleSub_ThenRequireGoogleSub_RoundTrips()
    {
        var context = FakeContext();

        CallerContext.SetGoogleSub(context, "user-sub-1");

        Assert.Equal("user-sub-1", CallerContext.RequireGoogleSub(context));
    }

    [Fact]
    public void RequireGoogleSub_NeverSet_ThrowsInvalidOperation()
    {
        var context = FakeContext();

        Assert.Throws<InvalidOperationException>(() => CallerContext.RequireGoogleSub(context));
    }
}
