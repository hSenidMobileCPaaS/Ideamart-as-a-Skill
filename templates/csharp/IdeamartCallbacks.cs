using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Ideamart;

/// <summary>
/// Ideamart callback (inbound webhook) endpoints — ASP.NET Core minimal APIs.
///
/// <para>Routes to register in the IdeaPro portal:</para>
/// <code>
///   MO SMS                    POST /api/ideamart/sms/mo
///   Delivery report           POST /api/ideamart/sms/dlr
///   USSD receive              POST /api/ideamart/ussd
///   Subscription notification POST /api/ideamart/subscription/notification
///   Charging notification     POST /api/ideamart/charging/notification
/// </code>
///
/// <para>The contract, for all five: respond <c>{"statusCode":"S1000","statusDetail":"Success"}</c>
/// with HTTP 200 — always, even for payloads you reject — respond FIRST and work afterwards, be
/// idempotent, and never trust the body.</para>
///
/// <para>Exclude these routes from authentication and antiforgery
/// (<c>.AllowAnonymous().DisableAntiforgery()</c>) and rely on the source-IP allowlist instead,
/// or you have left an open endpoint.</para>
///
/// <para>Full rules: references/07-callbacks.md.</para>
/// </summary>
public static class IdeamartCallbacks
{
    /// <summary>The only response Ideamart expects.</summary>
    private static readonly Dictionary<string, string> Ack = new()
    {
        ["statusCode"] = "S1000",
        ["statusDetail"] = "Success",
    };

    /// <summary>
    /// Restrict to Ideamart's egress IPs. Ideamart signs nothing, so there is no signature to
    /// verify — source IP is the strongest control available. Ask support for the current list.
    /// Prefer enforcing it at the firewall or load balancer; this is the fallback.
    /// </summary>
    public static readonly HashSet<string> SourceIps = new();

    public static IEndpointRouteBuilder MapIdeamartCallbacks(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/ideamart");

        group.MapPost("/sms/mo", MoSms);
        group.MapPost("/sms/dlr", DeliveryReport);
        group.MapPost("/ussd", Ussd);
        group.MapPost("/subscription/notification", SubscriptionNotification);
        group.MapPost("/charging/notification", ChargingNotification);

        return routes;
    }

    /* ── Shared guards ────────────────────────────────────────────────────── */

    private static IResult AckResult() => Results.Json(Ack);

    private static bool AllowedSource(HttpContext context)
    {
        if (SourceIps.Count == 0)
        {
            return true; // not configured yet
        }

        var ip = context.Connection.RemoteIpAddress?.ToString();
        return ip is not null && SourceIps.Contains(ip);
    }

    /// <summary>Read the body without failing the response on malformed input.</summary>
    private static async Task<JsonElement?> ReadJsonAsync(HttpRequest request)
    {
        try
        {
            return await request.ReadFromJsonAsync<JsonElement>().ConfigureAwait(false);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string Field(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value)
            ? value.ToString()
            : string.Empty;

    /* ── 1. MO SMS ────────────────────────────────────────────────────────── */

    private static async Task<IResult> MoSms(
        HttpContext context,
        IOptions<IdeamartOptions> options,
        IdeamartWorkQueue queue,
        ILogger<IdeamartWorkQueue> logger,
        IdeamartDedupe dedupe)
    {
        if (!AllowedSource(context))
        {
            return AckResult();
        }

        var body = await ReadJsonAsync(context.Request).ConfigureAwait(false);
        if (body is null || Field(body.Value, "applicationId") != options.Value.ApplicationId)
        {
            return AckResult();
        }

        var requestId = Field(body.Value, "requestId");
        if (requestId.Length == 0 || dedupe.IsDuplicate($"mo:{requestId}"))
        {
            return AckResult();
        }

        // Message content deliberately not logged — it is user communication.
        logger.LogInformation(
            "mo-sms requestId={RequestId} from={From}",
            requestId,
            IdeamartClient.MaskAddress(Field(body.Value, "sourceAddress")));

        await queue.EnqueueAsync(new IdeamartJob("sms.mo", body.Value.Clone()))
            .ConfigureAwait(false);
        return AckResult();
    }

    /* ── 2. SMS delivery report ───────────────────────────────────────────── */

    /// <summary>Ideamart and the SMPP gateway use different spellings. Normalise both.</summary>
    private static readonly Dictionary<string, string> DeliveryStatuses = new()
    {
        ["DELIVRD"] = "DELIVERED",
        ["UNDELIV"] = "UNDELIVERABLE",
        ["ACCEPTD"] = "ACCEPTED",
        ["REJECTD"] = "REJECTED",
    };

    private static async Task<IResult> DeliveryReport(
        HttpContext context,
        IdeamartWorkQueue queue,
        ILogger<IdeamartWorkQueue> logger,
        IdeamartDedupe dedupe)
    {
        if (!AllowedSource(context))
        {
            return AckResult();
        }

        var body = await ReadJsonAsync(context.Request).ConfigureAwait(false);
        if (body is null)
        {
            return AckResult();
        }

        var requestId = Field(body.Value, "requestId");
        var raw = Field(body.Value, "deliveryStatus");
        if (requestId.Length == 0 || raw.Length == 0)
        {
            return AckResult();
        }

        var status = DeliveryStatuses.TryGetValue(raw, out var normalised) ? normalised : raw;
        if (dedupe.IsDuplicate($"dlr:{requestId}:{status}"))
        {
            return AckResult();
        }

        logger.LogInformation(
            "delivery-report requestId={RequestId} status={Status}", requestId, status);

        await queue.EnqueueAsync(new IdeamartJob("sms.dlr", body.Value.Clone()))
            .ConfigureAwait(false);
        return AckResult();
    }

    /* ── 3. USSD receive ──────────────────────────────────────────────────── */

    /// <summary>
    /// The response body here is ONLY an acknowledgement. The screen the user sees comes from a
    /// separate POST /ussd/send — which is why the reply is queued rather than returned. USSD
    /// sessions time out in seconds, so nothing slow may happen before the acknowledgement.
    /// </summary>
    private static async Task<IResult> Ussd(
        HttpContext context,
        IOptions<IdeamartOptions> options,
        IdeamartWorkQueue queue,
        ILogger<IdeamartWorkQueue> logger,
        IdeamartDedupe dedupe)
    {
        if (!AllowedSource(context))
        {
            return AckResult();
        }

        var body = await ReadJsonAsync(context.Request).ConfigureAwait(false);
        if (body is null || Field(body.Value, "applicationId") != options.Value.ApplicationId)
        {
            return AckResult();
        }

        var sessionId = Field(body.Value, "sessionId");
        var source = Field(body.Value, "sourceAddress");
        if (sessionId.Length == 0 || source.Length == 0)
        {
            return AckResult();
        }

        if (dedupe.IsDuplicate($"ussd:{Field(body.Value, "requestId")}"))
        {
            return AckResult();
        }

        logger.LogInformation(
            "ussd sessionId={SessionId} operation={Operation} from={From}",
            sessionId,
            Field(body.Value, "ussdOperation"),
            IdeamartClient.MaskAddress(source));

        await queue.EnqueueAsync(new IdeamartJob("ussd.receive", body.Value.Clone()))
            .ConfigureAwait(false);
        return AckResult();
    }

    /* ── 4. Subscription notification ─────────────────────────────────────── */

    /// <summary>
    /// The authoritative source of subscription state — including changes you did not initiate
    /// (a user texting STOP, an operator removal, a billing failure). Consuming it is what lets
    /// you keep a local mirror instead of polling getStatus.
    /// </summary>
    private static async Task<IResult> SubscriptionNotification(
        HttpContext context,
        IOptions<IdeamartOptions> options,
        IdeamartWorkQueue queue,
        ILogger<IdeamartWorkQueue> logger,
        IdeamartDedupe dedupe)
    {
        if (!AllowedSource(context))
        {
            return AckResult();
        }

        var body = await ReadJsonAsync(context.Request).ConfigureAwait(false);
        if (body is null || Field(body.Value, "applicationId") != options.Value.ApplicationId)
        {
            return AckResult();
        }

        var subscriberId = Field(body.Value, "subscriberId");
        var status = Field(body.Value, "status");
        if (subscriberId.Length == 0 || status.Length == 0)
        {
            return AckResult();
        }

        if (dedupe.IsDuplicate($"sub:{subscriberId}:{status}:{Field(body.Value, "timeStamp")}"))
        {
            return AckResult();
        }

        logger.LogInformation(
            "subscription-notification subscriber={Subscriber} status={Status}",
            IdeamartClient.MaskAddress(subscriberId),
            status);

        await queue.EnqueueAsync(new IdeamartJob("subscription.notification", body.Value.Clone()))
            .ConfigureAwait(false);
        return AckResult();
    }

    /* ── 5. Charging notification ─────────────────────────────────────────── */

    /// <summary>
    /// Your reconciliation channel. Every charge left unknown after a timeout gets resolved
    /// here. Idempotency is not optional — a duplicate that double-counts revenue is a real bug
    /// with real consequences.
    ///
    /// <para>The payload mirrors the Direct Debit response: the same transaction identifiers
    /// carrying the final outcome. Read what you need, ignore anything else, and log the raw body
    /// on your first Limited Production charge so you can widen the handler.</para>
    /// </summary>
    private static async Task<IResult> ChargingNotification(
        HttpContext context,
        IdeamartWorkQueue queue,
        ILogger<IdeamartWorkQueue> logger,
        IdeamartDedupe dedupe)
    {
        if (!AllowedSource(context))
        {
            return AckResult();
        }

        var body = await ReadJsonAsync(context.Request).ConfigureAwait(false);
        if (body is null)
        {
            return AckResult();
        }

        var external = Field(body.Value, "externalTrxId");
        var key = external.Length > 0 ? external : Field(body.Value, "internalTrxId");
        if (key.Length == 0)
        {
            return AckResult();
        }

        var statusCode = Field(body.Value, "statusCode");
        if (dedupe.IsDuplicate($"charge:{key}:{statusCode}"))
        {
            return AckResult();
        }

        logger.LogInformation(
            "charging-notification externalTrxId={ExternalTrxId} statusCode={StatusCode}",
            external,
            statusCode);

        await queue.EnqueueAsync(new IdeamartJob("charging.notification", body.Value.Clone()))
            .ConfigureAwait(false);
        return AckResult();
    }
}

/// <summary>A payload handed off for processing after the response was sent.</summary>
public sealed record IdeamartJob(string Name, JsonElement Payload);

/// <summary>
/// Bounded in-process queue. Register as a singleton. For anything that must survive a crash —
/// charging reconciliation above all — publish to a real broker instead.
/// </summary>
public sealed class IdeamartWorkQueue
{
    private readonly Channel<IdeamartJob> _channel =
        Channel.CreateBounded<IdeamartJob>(new BoundedChannelOptions(1024)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
        });

    public ValueTask EnqueueAsync(IdeamartJob job) => _channel.Writer.WriteAsync(job);

    public IAsyncEnumerable<IdeamartJob> ReadAllAsync(CancellationToken cancellationToken) =>
        _channel.Reader.ReadAllAsync(cancellationToken);
}

/// <summary>Drains the queue outside the request lifetime. Register as a hosted service.</summary>
public sealed class IdeamartWorker : BackgroundService
{
    private readonly IdeamartWorkQueue _queue;
    private readonly IdeamartClient _client;
    private readonly ILogger<IdeamartWorker> _logger;

    public IdeamartWorker(
        IdeamartWorkQueue queue, IdeamartClient client, ILogger<IdeamartWorker> logger)
    {
        _queue = queue;
        _client = client;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in _queue.ReadAllAsync(stoppingToken).ConfigureAwait(false))
        {
            try
            {
                switch (job.Name)
                {
                    case "ussd.receive":
                        // Look up the session, decide the next screen, and reply with
                        // _client.SendUssdAsync(...). Terminal screens MUST use "mt-fin".
                        break;
                    case "sms.mo":
                        // Honour opt-out keywords, then handle your own commands.
                        break;
                    case "sms.dlr":
                        // Persist the latest status keyed by requestId.
                        break;
                    case "subscription.notification":
                        // Upsert your local subscription mirror.
                        break;
                    case "charging.notification":
                        // Reconcile against your transaction ledger by externalTrxId.
                        break;
                    default:
                        _logger.LogWarning("unknown job {Job}", job.Name);
                        break;
                }
            }
            catch (IdeamartException error)
            {
                _logger.LogError(
                    "job {Job} failed with {StatusCode}", job.Name, error.StatusCode);
                // Send to a dead-letter queue here.
            }
            catch (Exception error)
            {
                _logger.LogError(error, "job {Job} failed", job.Name);
            }
        }
    }
}

/// <summary>
/// Deduplication. DEVELOPMENT ONLY as written — replace the dictionary with Redis (SETNX + TTL)
/// or a unique database constraint in production, because an in-process store does not survive
/// a restart or a second instance, which is exactly when duplicates arrive.
/// </summary>
public sealed class IdeamartDedupe
{
    private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(10);
    private readonly ConcurrentDictionary<string, DateTimeOffset> _seen = new();

    public bool IsDuplicate(string key)
    {
        var now = DateTimeOffset.UtcNow;

        foreach (var entry in _seen)
        {
            if (entry.Value < now)
            {
                _seen.TryRemove(entry.Key, out _);
            }
        }

        return !_seen.TryAdd(key, now.Add(Ttl));
    }
}

/* ── Wiring ────────────────────────────────────────────────────────────────
 *
 *   builder.Services.AddHttpClient<IdeamartClient>();
 *   builder.Services.AddSingleton<IdeamartWorkQueue>();
 *   builder.Services.AddSingleton<IdeamartDedupe>();
 *   builder.Services.AddHostedService<IdeamartWorker>();
 *
 *   var app = builder.Build();
 *   app.MapIdeamartCallbacks();
 *
 * The USSD session store is not shown: use IDistributedCache backed by Redis, keyed by
 * sessionId with a ~2 minute expiry. An in-memory cache breaks the moment you run a second
 * instance, and the user's menu dies mid-flow.
 */
