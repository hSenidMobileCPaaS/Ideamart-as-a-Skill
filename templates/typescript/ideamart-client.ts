/**
 * Ideamart API client.
 *
 * One `post()` helper injects credentials, applies a timeout, and turns
 * non-S1000 responses into typed errors. Every service is a thin wrapper that
 * resolves its endpoint through `requireEndpoint()` — so calling an API your
 * application was not provisioned for fails locally with a clear message,
 * rather than as E1309 from the platform.
 *
 * The request bodies below match the demo application's verified-working calls
 * field for field. Optional parameters documented at docs.ideamart.io but not
 * exercised there are marked where they appear.
 *
 * SERVER-SIDE ONLY.
 */

import https from "node:https";
import { randomUUID } from "node:crypto";
import { config, requireEndpoint } from "./ideamart-config";
import type {
  BalanceQueryResponse,
  DirectDebitResponse,
  IdeamartBaseResponse,
  LbsLocateResponse,
  LbsLocateRequest,
  OtpApplicationMetaData,
  OtpRequestResponse,
  OtpVerifyResponse,
  QueryBaseResponse,
  SmsEncoding,
  SmsSendResponse,
  SubscriptionSendResponse,
  SubscriptionStatusResponse,
  UssdSendResponse,
} from "./ideamart-types";

/** A single outbound call should never hang. Protocol constant, not config. */
const TIMEOUT_MS = 15_000;

/**
 * Ideamart hosts have served an incomplete certificate chain, which Node
 * rejects — the demo application this client is derived from disabled
 * verification to work around it.
 *
 * Do NOT ship that. Disabling verification lets anyone on the path present
 * their own certificate and read the applicationId and password that can charge
 * your subscribers. The correct fix is to supply the missing intermediate CA:
 *
 *   const agent = new https.Agent({ ca: fs.readFileSync("ideamart-chain.pem") });
 *
 * See references/09-security-best-practices.md.
 */
const agent = new https.Agent({ keepAlive: true });

/* ── Errors ──────────────────────────────────────────────────────────────── */

/** Platform-side. Worth retrying with backoff. */
const TRANSIENT = new Set([
  "E1316", "E1318", "E1319", "E1332", "E1341",
  "E1360", "E1363", "E1364", "E1600", "E1601", "E1602", "E1603",
]);

/** Provisioning or credentials are wrong. Retrying will never help. */
const CONFIGURATION = new Set([
  "E1301", "E1302", "E1303", "E1304", "E1305", "E1306", "E1307",
  "E1309", "E1310", "E1311", "E1313", "E1315", "E1322", "E1323",
  "E1324", "E1327", "E1328", "E1329", "E1336", "E1371", "E1381",
  "E1383", "E1387",
]);

/** Codes meaning "the state you wanted already holds". */
export const BENIGN = {
  register: "E1351",   // user already registered
  unregister: "E1356", // user not registered
  debit: "E1379",      // transaction already completed
} as const;

export class IdeamartError extends Error {
  constructor(
    readonly statusCode: string,
    readonly statusDetail: string,
    readonly service: string,
    readonly raw?: unknown
  ) {
    super(`[${statusCode}] ${statusDetail} (${service})`);
    this.name = "IdeamartError";
  }
  get retryable() { return TRANSIENT.has(this.statusCode); }
  get isConfiguration() { return CONFIGURATION.has(this.statusCode); }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Normalise a subscriber address. The ONLY place `tel:` is added.
 *
 * Accepts an already-prefixed address, a masked hash, `+94…`, `0094…` or a
 * local `07…` number.
 */
export function toTelAddress(msisdn: string): string {
  const trimmed = (msisdn ?? "").trim();
  if (!trimmed) throw new Error("[ideamart] Empty subscriber address");
  if (trimmed.toLowerCase().startsWith("tel:")) return trimmed;

  let digits = trimmed.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = "94" + digits.slice(1);

  return `tel:${digits}`;
}

/** Mask a subscriber address for logging. Never log the raw value. */
export function maskAddress(address: string): string {
  const body = address.replace(/^tel:/i, "");
  if (body.length <= 6) return "tel:***";
  return `tel:${body.slice(0, 3)}${"*".repeat(body.length - 6)}${body.slice(-3)}`;
}

/** A unique, persistable idempotency key for a charge. Max 32 characters. */
export function generateExternalTrxId(): string {
  return randomUUID().replace(/-/g, "");
}

/* ── Core ────────────────────────────────────────────────────────────────── */

async function post<T extends IdeamartBaseResponse>(
  service: string,
  url: string,
  body: Record<string, unknown>,
  benignCodes: readonly string[] = []
): Promise<T> {
  const payload = JSON.stringify({
    applicationId: config.applicationId,
    password: config.password,
    ...body,
  });

  const data = await request<T>(url, payload);

  if (data.statusCode === "S1000") return data;
  if (benignCodes.includes(data.statusCode)) return data;

  throw new IdeamartError(data.statusCode, data.statusDetail, service, data);
}

function request<T>(url: string, body: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        agent,
        timeout: TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(
              new Error(`Non-JSON response (HTTP ${res.statusCode}): ${text.slice(0, 200)}`)
            );
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Ideamart request timed out after ${TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ── SMS ─────────────────────────────────────────────────────────────────── */

export interface SendSmsOptions {
  /** Optional. Must be a provisioned alias, or the send fails with E1331. */
  sourceAddress?: string;
  /** Optional. "1" requests a delivery report to your DLR callback URL. */
  deliveryStatusRequest?: "0" | "1";
  /** Optional. 0 Text (default) / 240 Flash / 245 Binary, hex-encoded. */
  encoding?: SmsEncoding;
  /** Optional. For variable-charge SMS services. */
  chargingAmount?: string;
}

/** Send an MT SMS to one or more subscribers. */
export function sendSms(
  to: string | string[],
  message: string,
  options: SendSmsOptions = {}
): Promise<SmsSendResponse> {
  const recipients = (Array.isArray(to) ? to : [to]).map(toTelAddress);
  if (recipients.includes("tel:all")) {
    throw new Error("[ideamart] Use broadcastSms() for tel:all — broadcasts must be deliberate.");
  }
  return post<SmsSendResponse>("sms-send", requireEndpoint("smsSend"), {
    message,
    destinationAddresses: recipients,
    ...options,
  });
}

/**
 * Send to the ENTIRE subscribed base.
 *
 * `tel:all` is documented, and it does exactly what it says. Deliberately
 * separate from sendSms so it can never be reached by accident — check the
 * subscriber base size first, and put an authorisation check in front of this.
 */
export function broadcastSms(
  message: string,
  confirmation: "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS",
  options: SendSmsOptions = {}
): Promise<SmsSendResponse> {
  if (confirmation !== "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS") {
    throw new Error("[ideamart] Broadcast confirmation token missing");
  }
  return post<SmsSendResponse>("sms-send", requireEndpoint("smsSend"), {
    message,
    destinationAddresses: ["tel:all"],
    ...options,
  });
}

/* ── USSD ────────────────────────────────────────────────────────────────── */

/**
 * Send a USSD screen.
 *
 * `sessionId` MUST be the one the platform sent you. Use "mt-fin" for the final
 * screen — anything else leaves the session hanging until the network times out.
 */
export function sendUssd(input: {
  sessionId: string;
  destinationAddress: string;
  message: string;
  operation: "mt-init" | "mt-cont" | "mt-fin";
}): Promise<UssdSendResponse> {
  return post<UssdSendResponse>("ussd-send", requireEndpoint("ussdSend"), {
    message: input.message,
    sessionId: input.sessionId,
    ussdOperation: input.operation,
    destinationAddress: toTelAddress(input.destinationAddress),
    encoding: "440",
    version: "1.0",
  });
}

/* ── Subscription ────────────────────────────────────────────────────────── */

/**
 * Opt a subscriber in. Only call this with recorded, explicit consent.
 *
 * E1351 (already registered) is accepted as success — the desired state holds.
 */
export function register(subscriberId: string): Promise<SubscriptionSendResponse> {
  return post<SubscriptionSendResponse>(
    "subscription-register",
    requireEndpoint("subscriptionSend"),
    { subscriberId: toTelAddress(subscriberId), action: "1", version: "1.0" },
    [BENIGN.register]
  );
}

/**
 * Opt a subscriber out.
 *
 * E1356 (not registered) is accepted as success — the desired state holds.
 */
export function unregister(subscriberId: string): Promise<SubscriptionSendResponse> {
  return post<SubscriptionSendResponse>(
    "subscription-unregister",
    requireEndpoint("subscriptionSend"),
    { subscriberId: toTelAddress(subscriberId), action: "0", version: "1.0" },
    [BENIGN.unregister]
  );
}

/** Check one subscriber's status. For reconciliation, not per-request gating. */
export function getSubscriptionStatus(
  subscriberId: string
): Promise<SubscriptionStatusResponse> {
  return post<SubscriptionStatusResponse>(
    "subscription-status",
    requireEndpoint("subscriptionStatus"),
    { subscriberId: toTelAddress(subscriberId) }
  );
}

/**
 * Subscriber base size. Needs no subscriber and charges nothing, which also
 * makes it the best connectivity and credential smoke test.
 *
 * `baseSize` comes back as a string, so a parsed number is returned alongside.
 */
export async function queryBase(): Promise<QueryBaseResponse & { size: number }> {
  const res = await post<QueryBaseResponse>(
    "subscription-query-base",
    requireEndpoint("subscriptionQueryBase"),
    {}
  );
  return { ...res, size: Number.parseInt(res.baseSize ?? "0", 10) };
}

/* ── OTP ─────────────────────────────────────────────────────────────────── */

/**
 * Send an OTP to a plain mobile number.
 *
 * Rate-limit per number AND per IP before calling, or the app becomes an
 * SMS-bombing tool. Keep the returned referenceNo server-side.
 */
export function requestOtp(input: {
  subscriberId: string;
  metaData: OtpApplicationMetaData;
  /** Optional. A UUID you generate per request, for tracing. */
  applicationHash?: string;
}): Promise<OtpRequestResponse> {
  return post<OtpRequestResponse>("otp-request", requireEndpoint("otpRequest"), {
    subscriberId: toTelAddress(input.subscriberId),
    applicationMetaData: input.metaData,
    ...(input.applicationHash ? { applicationHash: input.applicationHash } : {}),
  });
}

/**
 * Verify an OTP. Valid 60 minutes, maximum 3 attempts — enforce those limits on
 * your side too. The returned subscriberId is the masked identifier to use for
 * every subsequent call.
 */
export function verifyOtp(input: {
  referenceNo: string;
  otp: string;
}): Promise<OtpVerifyResponse> {
  return post<OtpVerifyResponse>("otp-verify", requireEndpoint("otpVerify"), {
    referenceNo: input.referenceNo,
    otp: input.otp,
  });
}

/* ── CaaS ────────────────────────────────────────────────────────────────── */

/**
 * Charge a subscriber's mobile account.
 *
 * THIS MOVES REAL MONEY.
 *
 * - `externalTrxId` is your idempotency key. Generate it with
 *   generateExternalTrxId(), PERSIST IT, then call this.
 * - There are deliberately no retries here. A timeout does NOT mean the charge
 *   failed. Resolve unknown outcomes by re-calling with the SAME externalTrxId,
 *   or by reconciling against the charging notification. Never re-roll the ID.
 * - E1379 (already completed) is accepted as success.
 */
export function debit(input: {
  subscriberId: string;
  amount: string;
  externalTrxId: string;
  currency?: string;
  /** Optional. The account of the payment instrument. */
  accountId?: string;
  /**
   * Optional in practice. The parameter table marks it mandatory, but the
   * documented sample request and verified working calls both omit it.
   */
  paymentInstrument?: string;
}): Promise<DirectDebitResponse> {
  if (!input.externalTrxId) {
    throw new Error("[ideamart] externalTrxId is required and must be persisted first");
  }
  if (input.externalTrxId.length > 32) {
    throw new Error("[ideamart] externalTrxId must be 32 characters or fewer");
  }
  return post<DirectDebitResponse>(
    "caas-direct-debit",
    requireEndpoint("caasDebit"),
    {
      externalTrxId: input.externalTrxId,
      subscriberId: toTelAddress(input.subscriberId),
      amount: input.amount,
      currency: input.currency ?? "LKR",
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.paymentInstrument ? { paymentInstrument: input.paymentInstrument } : {}),
    },
    [BENIGN.debit]
  );
}

/**
 * Query chargeable balance.
 *
 * Advisory only: the balance can change between this and the debit. Always
 * handle E1378 on the debit regardless of what this returned.
 *
 * Not configuring IDEAMART_CAAS_BALANCE_URL is how you disable this on an
 * application without the "Enable Query Balance Requests" toggle.
 */
export function queryBalance(input: {
  subscriberId: string;
  currency?: string;
  /** Optional. The account of the payment instrument. */
  accountId?: string;
}): Promise<BalanceQueryResponse> {
  return post<BalanceQueryResponse>("caas-balance-query", requireEndpoint("caasBalance"), {
    subscriberId: toTelAddress(input.subscriberId),
    currency: input.currency ?? "LKR",
    ...(input.accountId ? { accountId: input.accountId } : {}),
  });
}

/* ── LBS ─────────────────────────────────────────────────────────────────── */

/**
 * Locate a subscriber. Network-derived, accuracy in hundreds of metres.
 *
 * Requires explicit, purpose-specific consent — consent to receive SMS is not
 * consent to be located. Omit the QoS fields unless you know your provisioned
 * level; requesting above it fails with E1367.
 */
export function locate(
  input: Omit<LbsLocateRequest, "applicationId" | "password">
): Promise<LbsLocateResponse> {
  return post<LbsLocateResponse>("lbs-locate", requireEndpoint("lbsLocate"), {
    subscriberId: toTelAddress(input.subscriberId),
    serviceType: input.serviceType,
    ...(input.version ? { version: input.version } : {}),
    ...(input.responseTime ? { responseTime: input.responseTime } : {}),
    ...(input.horizontalAccuracy ? { horizontalAccuracy: input.horizontalAccuracy } : {}),
    ...(input.freshness ? { freshness: input.freshness } : {}),
  });
}

/* ── Extension point ─────────────────────────────────────────────────────── */

/**
 * Adding a service Ideamart publishes later:
 *
 *   1. Add its URL variable to .env.example and to `endpoints` in
 *      ideamart-config.ts
 *   2. Add request/response interfaces to ideamart-types.ts
 *   3. Add one wrapper here:
 *
 *        export function newThing(input: NewThingInput): Promise<NewThingResponse> {
 *          return post<NewThingResponse>("new-thing", requireEndpoint("newThing"), { ...input });
 *        }
 *
 * It inherits credential injection, the timeout, error mapping and the
 * not-provisioned guard for free. Do not build a parallel client.
 */
