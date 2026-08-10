using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;

namespace Ideamart;

/// <summary>
/// Ideamart API client — C# port of templates/typescript/ideamart-client.ts.
///
/// <para>One <c>PostAsync</c> helper injects credentials, applies a timeout, and turns
/// non-S1000 responses into typed errors. Every service is a thin wrapper that resolves its
/// endpoint through <see cref="IdeamartOptions.RequireEndpoint"/> — so calling an API your
/// application was not provisioned for fails locally with a clear message, rather than as
/// E1309 from the platform.</para>
///
/// <para>Register with <c>IHttpClientFactory</c>:
/// <c>builder.Services.AddHttpClient&lt;IdeamartClient&gt;();</c></para>
///
/// <para>SERVER-SIDE ONLY.</para>
/// </summary>
public sealed class IdeamartClient
{
    /// <summary>A single outbound call should never hang. Protocol constant, not config.</summary>
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(15);

    /// <summary>Platform-side. Worth retrying with backoff.</summary>
    public static readonly IReadOnlySet<string> Transient = new HashSet<string>
    {
        "E1316", "E1318", "E1319", "E1332", "E1341",
        "E1360", "E1363", "E1364", "E1600", "E1601", "E1602", "E1603",
    };

    /// <summary>Provisioning or credentials are wrong. Retrying will never help.</summary>
    public static readonly IReadOnlySet<string> Configuration = new HashSet<string>
    {
        "E1301", "E1302", "E1303", "E1304", "E1305", "E1306", "E1307",
        "E1309", "E1310", "E1311", "E1313", "E1315", "E1322", "E1323",
        "E1324", "E1327", "E1328", "E1329", "E1336", "E1371", "E1381",
        "E1383", "E1387",
    };

    // Codes meaning "the state you wanted already holds".
    public const string BenignRegister = "E1351";   // user already registered
    public const string BenignUnregister = "E1356"; // user not registered
    public const string BenignDebit = "E1379";      // transaction already completed

    public const string BroadcastConfirmation = "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS";

    private readonly IdeamartOptions _options;
    private readonly HttpClient _http;

    /// <summary>
    /// Ideamart hosts have served an incomplete certificate chain, which .NET rejects. Do NOT
    /// install a callback that returns true unconditionally — that lets anyone on the path read
    /// the applicationId and password that can charge your subscribers. Supply the intermediate
    /// CA through a SocketsHttpHandler with a custom trust store instead. See
    /// references/09-security-best-practices.md.
    /// </summary>
    public IdeamartClient(HttpClient http, IOptions<IdeamartOptions> options)
    {
        _http = http;
        _http.Timeout = Timeout;
        _options = options.Value;
    }

    /* ── Helpers ──────────────────────────────────────────────────────────── */

    private static readonly Regex Separators = new(@"[\s()\-]", RegexOptions.Compiled);

    /// <summary>
    /// Normalise a subscriber address. The ONLY place <c>tel:</c> is added. Accepts an
    /// already-prefixed address, a masked hash, +94…, 0094… or a local 07… number.
    /// </summary>
    public static string ToTelAddress(string msisdn)
    {
        var trimmed = (msisdn ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            throw new ArgumentException("[ideamart] Empty subscriber address", nameof(msisdn));
        }

        if (trimmed.StartsWith("tel:", StringComparison.OrdinalIgnoreCase))
        {
            return trimmed;
        }

        var digits = Separators.Replace(trimmed, string.Empty).TrimStart('+');
        if (digits.StartsWith("00", StringComparison.Ordinal))
        {
            digits = digits[2..];
        }

        if (digits.StartsWith("0", StringComparison.Ordinal) && digits.Length == 10)
        {
            digits = "94" + digits[1..];
        }

        return "tel:" + digits;
    }

    /// <summary>Mask a subscriber address for logging. Never log the raw value.</summary>
    public static string MaskAddress(string address)
    {
        var body = address ?? string.Empty;
        if (body.StartsWith("tel:", StringComparison.OrdinalIgnoreCase))
        {
            body = body[4..];
        }

        return body.Length <= 6
            ? "tel:***"
            : $"tel:{body[..3]}{new string('*', body.Length - 6)}{body[^3..]}";
    }

    /// <summary>A unique, persistable idempotency key for a charge. Max 32 characters.</summary>
    public static string GenerateExternalTrxId() => Guid.NewGuid().ToString("N");

    /* ── Core ─────────────────────────────────────────────────────────────── */

    private async Task<JsonElement> PostAsync(
        string service,
        string url,
        IDictionary<string, object?> body,
        CancellationToken cancellationToken,
        params string[] benignCodes)
    {
        var payload = new Dictionary<string, object?>(body)
        {
            ["applicationId"] = _options.ApplicationId,
            ["password"] = _options.Password,
        };

        using var response = await _http
            .PostAsJsonAsync(url, payload, cancellationToken)
            .ConfigureAwait(false);

        // response.EnsureSuccessStatusCode() is deliberately NOT called: Ideamart returns
        // HTTP 200 for application-level failures, and the real outcome is statusCode.
        var data = await response.Content
            .ReadFromJsonAsync<JsonElement>(cancellationToken: cancellationToken)
            .ConfigureAwait(false);

        var statusCode = data.TryGetProperty("statusCode", out var code)
            ? code.GetString() ?? string.Empty
            : string.Empty;

        if (statusCode == "S1000" || benignCodes.Contains(statusCode))
        {
            return data;
        }

        var detail = data.TryGetProperty("statusDetail", out var value)
            ? value.GetString() ?? string.Empty
            : string.Empty;

        throw new IdeamartException(statusCode, detail, service);
    }

    /* ── SMS ──────────────────────────────────────────────────────────────── */

    /// <summary>Send an MT SMS to one or more subscribers.</summary>
    public Task<JsonElement> SendSmsAsync(
        IEnumerable<string> to,
        string message,
        CancellationToken cancellationToken = default)
    {
        var recipients = to.Select(ToTelAddress).ToList();
        if (recipients.Contains("tel:all"))
        {
            throw new ArgumentException(
                "[ideamart] Use BroadcastSmsAsync for tel:all — broadcasts must be deliberate.",
                nameof(to));
        }

        return PostAsync(
            "sms-send",
            _options.RequireEndpoint("SmsSend"),
            new Dictionary<string, object?>
            {
                ["message"] = message,
                ["destinationAddresses"] = recipients,
            },
            cancellationToken);
    }

    /// <summary>
    /// Send to the ENTIRE subscribed base. Deliberately separate from
    /// <see cref="SendSmsAsync"/> so it can never be reached by accident — check the subscriber
    /// base size first, and put an authorisation check in front of this.
    /// </summary>
    public Task<JsonElement> BroadcastSmsAsync(
        string message,
        string confirmation,
        CancellationToken cancellationToken = default)
    {
        if (confirmation != BroadcastConfirmation)
        {
            throw new ArgumentException(
                "[ideamart] Broadcast confirmation token missing", nameof(confirmation));
        }

        return PostAsync(
            "sms-send",
            _options.RequireEndpoint("SmsSend"),
            new Dictionary<string, object?>
            {
                ["message"] = message,
                ["destinationAddresses"] = new[] { "tel:all" },
            },
            cancellationToken);
    }

    /* ── USSD ─────────────────────────────────────────────────────────────── */

    /// <summary>
    /// Send a USSD screen. <paramref name="sessionId"/> MUST be the one the platform sent you.
    /// Use "mt-fin" for the final screen — anything else leaves the session hanging until the
    /// network times out.
    /// </summary>
    public Task<JsonElement> SendUssdAsync(
        string sessionId,
        string destinationAddress,
        string message,
        string operation,
        CancellationToken cancellationToken = default)
    {
        if (operation is not ("mt-init" or "mt-cont" or "mt-fin"))
        {
            throw new ArgumentException(
                $"[ideamart] Invalid ussdOperation '{operation}'", nameof(operation));
        }

        return PostAsync(
            "ussd-send",
            _options.RequireEndpoint("UssdSend"),
            new Dictionary<string, object?>
            {
                ["message"] = message,
                ["sessionId"] = sessionId,
                ["ussdOperation"] = operation,
                ["destinationAddress"] = ToTelAddress(destinationAddress),
                ["encoding"] = "440",
                ["version"] = "1.0",
            },
            cancellationToken);
    }

    /* ── Subscription ─────────────────────────────────────────────────────── */

    /// <summary>
    /// Opt a subscriber in. Only call this with recorded, explicit consent. E1351 (already
    /// registered) is accepted as success — the desired state holds.
    /// </summary>
    public Task<JsonElement> RegisterAsync(
        string subscriberId, CancellationToken cancellationToken = default) =>
        SubscriptionAsync(
            "subscription-register", subscriberId, "1", BenignRegister, cancellationToken);

    /// <summary>
    /// Opt a subscriber out. E1356 (not registered) is accepted as success — the desired state
    /// holds.
    /// </summary>
    public Task<JsonElement> UnregisterAsync(
        string subscriberId, CancellationToken cancellationToken = default) =>
        SubscriptionAsync(
            "subscription-unregister", subscriberId, "0", BenignUnregister, cancellationToken);

    private Task<JsonElement> SubscriptionAsync(
        string service,
        string subscriberId,
        string action,
        string benign,
        CancellationToken cancellationToken) =>
        PostAsync(
            service,
            _options.RequireEndpoint("SubscriptionSend"),
            new Dictionary<string, object?>
            {
                ["subscriberId"] = ToTelAddress(subscriberId),
                ["action"] = action,
                ["version"] = "1.0",
            },
            cancellationToken,
            benign);

    /// <summary>Check one subscriber's status. For reconciliation, not per-request gating.</summary>
    public Task<JsonElement> GetSubscriptionStatusAsync(
        string subscriberId, CancellationToken cancellationToken = default) =>
        PostAsync(
            "subscription-status",
            _options.RequireEndpoint("SubscriptionStatus"),
            new Dictionary<string, object?> { ["subscriberId"] = ToTelAddress(subscriberId) },
            cancellationToken);

    /// <summary>
    /// Subscriber base size. Needs no subscriber and charges nothing, which also makes it the
    /// best connectivity and credential smoke test. <c>baseSize</c> comes back as a string.
    /// </summary>
    public async Task<long> QueryBaseAsync(CancellationToken cancellationToken = default)
    {
        var data = await PostAsync(
            "subscription-query-base",
            _options.RequireEndpoint("SubscriptionQueryBase"),
            new Dictionary<string, object?>(),
            cancellationToken).ConfigureAwait(false);

        var raw = data.TryGetProperty("baseSize", out var value) ? value.GetString() : "0";
        return long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var size)
            ? size
            : 0;
    }

    /* ── OTP ──────────────────────────────────────────────────────────────── */

    /// <summary>
    /// Send an OTP to a plain mobile number. Rate-limit per number AND per IP before calling,
    /// or the app becomes an SMS-bombing tool. Keep the returned referenceNo server-side.
    /// </summary>
    public Task<JsonElement> RequestOtpAsync(
        string subscriberId,
        IDictionary<string, object?> applicationMetaData,
        CancellationToken cancellationToken = default) =>
        PostAsync(
            "otp-request",
            _options.RequireEndpoint("OtpRequest"),
            new Dictionary<string, object?>
            {
                ["subscriberId"] = ToTelAddress(subscriberId),
                ["applicationMetaData"] = applicationMetaData,
            },
            cancellationToken);

    /// <summary>
    /// Verify an OTP. Valid 60 minutes, maximum 3 attempts — enforce those limits on your side
    /// too. The returned subscriberId is the masked identifier to use for every subsequent call.
    /// </summary>
    public Task<JsonElement> VerifyOtpAsync(
        string referenceNo, string otp, CancellationToken cancellationToken = default) =>
        PostAsync(
            "otp-verify",
            _options.RequireEndpoint("OtpVerify"),
            new Dictionary<string, object?> { ["referenceNo"] = referenceNo, ["otp"] = otp },
            cancellationToken);

    /* ── CaaS ─────────────────────────────────────────────────────────────── */

    /// <summary>
    /// Charge a subscriber's mobile account. THIS MOVES REAL MONEY.
    ///
    /// <para><paramref name="externalTrxId"/> is your idempotency key: generate it with
    /// <see cref="GenerateExternalTrxId"/>, PERSIST IT, then call this. There are deliberately
    /// no retries — a timeout does NOT mean the charge failed. Resolve unknown outcomes by
    /// re-calling with the SAME id, or by reconciling against the charging notification. E1379
    /// (already completed) is accepted as success.</para>
    ///
    /// <para><paramref name="amount"/> is <c>decimal</c>, never <c>double</c>.</para>
    /// </summary>
    public Task<JsonElement> DebitAsync(
        string subscriberId,
        decimal amount,
        string externalTrxId,
        string currency = "LKR",
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(externalTrxId))
        {
            throw new ArgumentException(
                "[ideamart] externalTrxId is required and must be persisted first",
                nameof(externalTrxId));
        }

        if (externalTrxId.Length > 32)
        {
            throw new ArgumentException(
                "[ideamart] externalTrxId must be 32 characters or fewer", nameof(externalTrxId));
        }

        return PostAsync(
            "caas-direct-debit",
            _options.RequireEndpoint("CaasDebit"),
            new Dictionary<string, object?>
            {
                ["externalTrxId"] = externalTrxId,
                ["subscriberId"] = ToTelAddress(subscriberId),
                ["amount"] = amount.ToString(CultureInfo.InvariantCulture),
                ["currency"] = currency,
            },
            cancellationToken,
            BenignDebit);
    }

    /// <summary>
    /// Query chargeable balance. Advisory only: the balance can change between this and the
    /// debit. Always handle E1378 on the debit regardless of what this returned.
    /// </summary>
    public Task<JsonElement> QueryBalanceAsync(
        string subscriberId,
        string currency = "LKR",
        CancellationToken cancellationToken = default) =>
        PostAsync(
            "caas-balance-query",
            _options.RequireEndpoint("CaasBalance"),
            new Dictionary<string, object?>
            {
                ["subscriberId"] = ToTelAddress(subscriberId),
                ["currency"] = currency,
            },
            cancellationToken);

    /* ── LBS ──────────────────────────────────────────────────────────────── */

    /// <summary>
    /// Locate a subscriber. Network-derived, accuracy in hundreds of metres. Requires explicit,
    /// purpose-specific consent — consent to receive SMS is not consent to be located. Omit the
    /// QoS fields unless you know your provisioned level; requesting above it fails with E1367.
    /// </summary>
    public Task<JsonElement> LocateAsync(
        string subscriberId, string serviceType, CancellationToken cancellationToken = default) =>
        PostAsync(
            "lbs-locate",
            _options.RequireEndpoint("LbsLocate"),
            new Dictionary<string, object?>
            {
                ["subscriberId"] = ToTelAddress(subscriberId),
                ["serviceType"] = serviceType,
            },
            cancellationToken);

    /* ── Extension point ───────────────────────────────────────────────────
     *
     * Adding a service Ideamart publishes later:
     *
     *   1. Add its URL variable to .env.example and to EndpointVariables in IdeamartOptions
     *   2. Add one wrapper here that calls PostAsync with the new key.
     *
     * It inherits credential injection, the timeout, error mapping and the not-provisioned
     * guard for free. Do not build a parallel client.
     */
}

/// <summary>A non-S1000 application-level response.</summary>
public sealed class IdeamartException : Exception
{
    public IdeamartException(string statusCode, string statusDetail, string service)
        : base($"[{statusCode}] {statusDetail} ({service})")
    {
        StatusCode = statusCode;
        StatusDetail = statusDetail;
        Service = service;
    }

    public string StatusCode { get; }

    public string StatusDetail { get; }

    public string Service { get; }

    public bool IsRetryable => IdeamartClient.Transient.Contains(StatusCode);

    public bool IsConfiguration => IdeamartClient.Configuration.Contains(StatusCode);
}
