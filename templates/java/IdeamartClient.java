package com.example.ideamart;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Ideamart API client — Java port of templates/typescript/ideamart-client.ts.
 *
 * <p>One {@link #post} helper injects credentials, applies a timeout, and turns non-S1000
 * responses into typed errors. Every service is a thin wrapper that resolves its endpoint
 * through {@link IdeamartConfig#requireEndpoint} — so calling an API your application was not
 * provisioned for fails locally with a clear message, rather than as E1309 from the platform.
 *
 * <p>Java 17 ({@code java.net.http.HttpClient}, {@code Stream.toList()}, switch expressions) and
 * Jackson — the Spring Boot 3 baseline. On Java 11 replace {@code .toList()} with
 * {@code .collect(Collectors.toList())}. Register it as a singleton bean; it is thread-safe and
 * the underlying {@code HttpClient} pools connections.
 *
 * <p>SERVER-SIDE ONLY.
 */
public final class IdeamartClient {

  /** A single outbound call should never hang. Protocol constant, not config. */
  private static final Duration TIMEOUT = Duration.ofSeconds(15);

  /** Platform-side. Worth retrying with backoff. */
  private static final Set<String> TRANSIENT =
      Set.of(
          "E1316", "E1318", "E1319", "E1332", "E1341", "E1360", "E1363", "E1364", "E1600",
          "E1601", "E1602", "E1603");

  /** Provisioning or credentials are wrong. Retrying will never help. */
  private static final Set<String> CONFIGURATION =
      Set.of(
          "E1301", "E1302", "E1303", "E1304", "E1305", "E1306", "E1307", "E1309", "E1310",
          "E1311", "E1313", "E1315", "E1322", "E1323", "E1324", "E1327", "E1328", "E1329",
          "E1336", "E1371", "E1381", "E1383", "E1387");

  /** Codes meaning "the state you wanted already holds". */
  public static final String BENIGN_REGISTER = "E1351"; // user already registered
  public static final String BENIGN_UNREGISTER = "E1356"; // user not registered
  public static final String BENIGN_DEBIT = "E1379"; // transaction already completed

  private final IdeamartConfig config;
  private final ObjectMapper mapper = new ObjectMapper();
  private final HttpClient http;

  public IdeamartClient(IdeamartConfig config) {
    this.config = config;
    // Ideamart hosts have served an incomplete certificate chain, which strict clients reject.
    // Do NOT install a trust-all TrustManager to work around it — that lets anyone on the path
    // read the applicationId and password that can charge your subscribers. Import the
    // intermediate CA into a truststore and point an SSLContext at it instead:
    //
    //   .sslContext(SSLContexts.custom().loadTrustMaterial(truststore, null).build())
    //
    // See references/09-security-best-practices.md.
    this.http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
  }

  /* ── Errors ─────────────────────────────────────────────────────────────── */

  public static final class IdeamartException extends RuntimeException {
    private final String statusCode;
    private final String statusDetail;
    private final String service;

    IdeamartException(String statusCode, String statusDetail, String service) {
      super("[" + statusCode + "] " + statusDetail + " (" + service + ")");
      this.statusCode = statusCode;
      this.statusDetail = statusDetail;
      this.service = service;
    }

    public String statusCode() {
      return statusCode;
    }

    public String statusDetail() {
      return statusDetail;
    }

    public String service() {
      return service;
    }

    public boolean isRetryable() {
      return TRANSIENT.contains(statusCode);
    }

    public boolean isConfiguration() {
      return CONFIGURATION.contains(statusCode);
    }
  }

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  /**
   * Normalise a subscriber address. The ONLY place {@code tel:} is added.
   *
   * <p>Accepts an already-prefixed address, a masked hash, +94…, 0094… or a local 07… number.
   */
  public static String toTelAddress(String msisdn) {
    String trimmed = msisdn == null ? "" : msisdn.trim();
    if (trimmed.isEmpty()) {
      throw new IllegalArgumentException("[ideamart] Empty subscriber address");
    }
    if (trimmed.toLowerCase(Locale.ROOT).startsWith("tel:")) {
      return trimmed;
    }
    String digits = trimmed.replaceAll("[\\s()-]", "").replaceFirst("^\\+", "");
    if (digits.startsWith("00")) {
      digits = digits.substring(2);
    }
    if (digits.startsWith("0") && digits.length() == 10) {
      digits = "94" + digits.substring(1);
    }
    return "tel:" + digits;
  }

  /** Mask a subscriber address for logging. Never log the raw value. */
  public static String maskAddress(String address) {
    String body = address == null ? "" : address.replaceFirst("(?i)^tel:", "");
    if (body.length() <= 6) {
      return "tel:***";
    }
    return "tel:"
        + body.substring(0, 3)
        + "*".repeat(body.length() - 6)
        + body.substring(body.length() - 3);
  }

  /** A unique, persistable idempotency key for a charge. Max 32 characters. */
  public static String generateExternalTrxId() {
    return UUID.randomUUID().toString().replace("-", "");
  }

  /* ── Core ───────────────────────────────────────────────────────────────── */

  private JsonNode post(String service, String url, Map<String, Object> body, String... benign) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("applicationId", config.applicationId());
    payload.put("password", config.password());
    payload.putAll(body);

    JsonNode data;
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(url))
              .timeout(TIMEOUT)
              .header("Content-Type", "application/json")
              .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
              .build();
      HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
      // The HTTP status is deliberately not consulted: Ideamart returns 200 for
      // application-level failures, and the real outcome is statusCode in the body.
      data = mapper.readTree(response.body());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("[ideamart] " + service + " interrupted", e);
    } catch (Exception e) {
      throw new IllegalStateException("[ideamart] " + service + " transport failure", e);
    }

    String statusCode = data.path("statusCode").asText("");
    if ("S1000".equals(statusCode) || List.of(benign).contains(statusCode)) {
      return data;
    }
    throw new IdeamartException(statusCode, data.path("statusDetail").asText(""), service);
  }

  /* ── SMS ────────────────────────────────────────────────────────────────── */

  /** Send an MT SMS to one or more subscribers. */
  public JsonNode sendSms(List<String> to, String message) {
    List<String> recipients = to.stream().map(IdeamartClient::toTelAddress).toList();
    if (recipients.contains("tel:all")) {
      throw new IllegalArgumentException(
          "[ideamart] Use broadcastSms() for tel:all — broadcasts must be deliberate.");
    }
    return post(
        "sms-send",
        config.requireEndpoint("smsSend"),
        Map.of("message", message, "destinationAddresses", recipients));
  }

  public static final String BROADCAST_CONFIRMATION =
      "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS";

  /**
   * Send to the ENTIRE subscribed base.
   *
   * <p>Deliberately separate from {@link #sendSms} so it can never be reached by accident —
   * check the subscriber base size first, and put an authorisation check in front of this.
   */
  public JsonNode broadcastSms(String message, String confirmation) {
    if (!BROADCAST_CONFIRMATION.equals(confirmation)) {
      throw new IllegalArgumentException("[ideamart] Broadcast confirmation token missing");
    }
    return post(
        "sms-send",
        config.requireEndpoint("smsSend"),
        Map.of("message", message, "destinationAddresses", List.of("tel:all")));
  }

  /* ── USSD ───────────────────────────────────────────────────────────────── */

  /**
   * Send a USSD screen.
   *
   * <p>{@code sessionId} MUST be the one the platform sent you. Use "mt-fin" for the final
   * screen — anything else leaves the session hanging until the network times out.
   */
  public JsonNode sendUssd(
      String sessionId, String destinationAddress, String message, String operation) {
    if (!Set.of("mt-init", "mt-cont", "mt-fin").contains(operation)) {
      throw new IllegalArgumentException("[ideamart] Invalid ussdOperation '" + operation + "'");
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("message", message);
    body.put("sessionId", sessionId);
    body.put("ussdOperation", operation);
    body.put("destinationAddress", toTelAddress(destinationAddress));
    body.put("encoding", "440");
    body.put("version", "1.0");
    return post("ussd-send", config.requireEndpoint("ussdSend"), body);
  }

  /* ── Subscription ───────────────────────────────────────────────────────── */

  /**
   * Opt a subscriber in. Only call this with recorded, explicit consent.
   *
   * <p>E1351 (already registered) is accepted as success — the desired state holds.
   */
  public JsonNode register(String subscriberId) {
    return post(
        "subscription-register",
        config.requireEndpoint("subscriptionSend"),
        Map.of("subscriberId", toTelAddress(subscriberId), "action", "1", "version", "1.0"),
        BENIGN_REGISTER);
  }

  /**
   * Opt a subscriber out.
   *
   * <p>E1356 (not registered) is accepted as success — the desired state holds.
   */
  public JsonNode unregister(String subscriberId) {
    return post(
        "subscription-unregister",
        config.requireEndpoint("subscriptionSend"),
        Map.of("subscriberId", toTelAddress(subscriberId), "action", "0", "version", "1.0"),
        BENIGN_UNREGISTER);
  }

  /** Check one subscriber's status. For reconciliation, not per-request gating. */
  public JsonNode getSubscriptionStatus(String subscriberId) {
    return post(
        "subscription-status",
        config.requireEndpoint("subscriptionStatus"),
        Map.of("subscriberId", toTelAddress(subscriberId)));
  }

  /**
   * Subscriber base size. Needs no subscriber and charges nothing, which also makes it the best
   * connectivity and credential smoke test. {@code baseSize} comes back as a string.
   */
  public long queryBase() {
    JsonNode data =
        post("subscription-query-base", config.requireEndpoint("subscriptionQueryBase"), Map.of());
    return Long.parseLong(data.path("baseSize").asText("0"));
  }

  /* ── OTP ────────────────────────────────────────────────────────────────── */

  /**
   * Send an OTP to a plain mobile number.
   *
   * <p>Rate-limit per number AND per IP before calling, or the app becomes an SMS-bombing tool.
   * Keep the returned referenceNo server-side; never log it.
   */
  public JsonNode requestOtp(String subscriberId, Map<String, Object> applicationMetaData) {
    return post(
        "otp-request",
        config.requireEndpoint("otpRequest"),
        Map.of(
            "subscriberId", toTelAddress(subscriberId),
            "applicationMetaData", applicationMetaData));
  }

  /**
   * Verify an OTP. Valid 60 minutes, maximum 3 attempts — enforce those limits on your side too.
   * The returned subscriberId is the masked identifier to use for every subsequent call.
   */
  public JsonNode verifyOtp(String referenceNo, String otp) {
    return post(
        "otp-verify",
        config.requireEndpoint("otpVerify"),
        Map.of("referenceNo", referenceNo, "otp", otp));
  }

  /* ── CaaS ───────────────────────────────────────────────────────────────── */

  /**
   * Charge a subscriber's mobile account.
   *
   * <p>THIS MOVES REAL MONEY.
   *
   * <ul>
   *   <li>{@code externalTrxId} is your idempotency key. Generate it with {@link
   *       #generateExternalTrxId()}, PERSIST IT, then call this.
   *   <li>There are deliberately no retries here. A timeout does NOT mean the charge failed.
   *       Resolve unknown outcomes by re-calling with the SAME externalTrxId, or by reconciling
   *       against the charging notification. Never re-roll the id.
   *   <li>E1379 (already completed) is accepted as success.
   *   <li>Amount is {@link BigDecimal} — never {@code double}.
   * </ul>
   */
  public JsonNode debit(
      String subscriberId, BigDecimal amount, String externalTrxId, String currency) {
    if (externalTrxId == null || externalTrxId.isBlank()) {
      throw new IllegalArgumentException(
          "[ideamart] externalTrxId is required and must be persisted first");
    }
    if (externalTrxId.length() > 32) {
      throw new IllegalArgumentException("[ideamart] externalTrxId must be 32 characters or fewer");
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("externalTrxId", externalTrxId);
    body.put("subscriberId", toTelAddress(subscriberId));
    body.put("amount", amount.toPlainString());
    body.put("currency", currency == null ? "LKR" : currency);
    return post("caas-direct-debit", config.requireEndpoint("caasDebit"), body, BENIGN_DEBIT);
  }

  /**
   * Query chargeable balance.
   *
   * <p>Advisory only: the balance can change between this and the debit. Always handle E1378 on
   * the debit regardless of what this returned.
   */
  public JsonNode queryBalance(String subscriberId, String currency) {
    return post(
        "caas-balance-query",
        config.requireEndpoint("caasBalance"),
        Map.of(
            "subscriberId", toTelAddress(subscriberId),
            "currency", currency == null ? "LKR" : currency));
  }

  /* ── LBS ────────────────────────────────────────────────────────────────── */

  /**
   * Locate a subscriber. Network-derived, accuracy in hundreds of metres.
   *
   * <p>Requires explicit, purpose-specific consent — consent to receive SMS is not consent to be
   * located. Omit the QoS fields unless you know your provisioned level; requesting above it
   * fails with E1367.
   */
  public JsonNode locate(String subscriberId, String serviceType) {
    return post(
        "lbs-locate",
        config.requireEndpoint("lbsLocate"),
        Map.of("subscriberId", toTelAddress(subscriberId), "serviceType", serviceType));
  }

  /* ── Extension point ────────────────────────────────────────────────────────
   *
   * Adding a service Ideamart publishes later:
   *
   *   1. Add its URL variable to .env.example and to ENDPOINT_VARS in IdeamartConfig
   *   2. Add one wrapper here:
   *
   *        public JsonNode newThing(Map<String, Object> input) {
   *          return post("new-thing", config.requireEndpoint("newThing"), input);
   *        }
   *
   * It inherits credential injection, the timeout, error mapping and the not-provisioned guard
   * for free. Do not build a parallel client.
   */
}
