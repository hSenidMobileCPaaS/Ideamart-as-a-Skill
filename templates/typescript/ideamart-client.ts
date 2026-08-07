/**
 * Ideamart API client.
 *
 * One `post()` helper injects credentials, applies timeouts, retries transient
 * failures, and turns non-S1000 responses into typed errors. Every service is
 * a thin wrapper over it.
 *
 * Adding a new Ideamart service = one endpoint in ideamart-config.ts + one
 * method here. Never write a bespoke fetch call at a call site.
 *
 * SERVER-SIDE ONLY.
 */

import fs from "node:fs";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { config } from "./ideamart-config";
import type {
  BalanceQueryResponse,
  DirectDebitResponse,
  IdeamartBaseResponse,
  LbsLocateRequest,
  LbsLocateResponse,
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

/* ── Errors ──────────────────────────────────────────────────────────────── */

/** Platform-side, worth retrying with backoff. */
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

/**
 * Codes meaning "the state you wanted already holds". Callers should treat
 * these as success for the matching operation.
 */
export const BENIGN = {
  register: "E1351",   // user already registered
  unregister: "E1356", // user not registered
  debit: "E1379",      // transaction already completed
} as const;

export class IdeamartError extends Error {
  constructor(
    readonly statusCode: string,
    readonly statusDetail: string,
    readonly endpoint: string,
    readonly raw?: unknown
  ) {
    super(`[${statusCode}] ${statusDetail} (${endpoint})`);
    this.name = "IdeamartError";
  }
  get retryable() { return TRANSIENT.has(this.statusCode); }
  get isConfiguration() { return CONFIGURATION.has(this.statusCode); }
}

export class IdeamartTransportError extends Error {
  constructor(message: string, readonly endpoint: string, readonly cause?: unknown) {
    super(message);
    this.name = "IdeamartTransportError";
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Normalise a subscriber address. The ONLY place `tel:` is added — never
 * concatenate it inline.
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
  // Local Sri Lankan format 07XXXXXXXX → 947XXXXXXXX
  if (digits.startsWith("0") && digits.length === 10) digits = "94" + digits.slice(1);

  return `tel:${digits}`;
}

/** Mask a subscriber address for logging. Never log the raw value. */
export function maskAddress(address: string): string {
  const body = address.replace(/^tel:/i, "");
  if (body.length <= 6) return "tel:***";
  return `tel:${body.slice(0, 3)}${"*".repeat(body.length - 6)}${body.slice(-3)}`;
}

/** A unique, persistable idempotency key for a charge. Max 32 chars. */
export function generateExternalTrxId(): string {
  return randomUUID().replace(/-/g, ""); // 32 hex chars
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── HTTPS agent ─────────────────────────────────────────────────────────── */

/**
 * Some Ideamart hosts serve an incomplete certificate chain. The correct fix
 * is to supply the missing intermediate CA, NOT to disable verification —
 * disabling it exposes the credentials that can charge your subscribers.
 */
const agent = new https.Agent({
  keepAlive: true,
  ...(config.tls.caBundlePath
    ? { ca: fs.readFileSync(config.tls.caBundlePath) }
    : {}),
  ...(config.tls.insecure ? { rejectUnauthorized: false } : {}),
});

/* ── Core ────────────────────────────────────────────────────────────────── */

export interface PostOptions {
  /** Absolute URL, for services not on the main base URL (LBS). */
  absoluteUrl?: string;
  /** Disable retries. Always true for charging — see debit(). */
  noRetry?: boolean;
  /** Status codes to accept as success for this call. */
  benignCodes?: readonly string[];
}

async function post<T extends IdeamartBaseResponse>(
  endpoint: string,
  payload: Record<string, unknown>,
  options: PostOptions = {}
): Promise<T> {
  const url = options.absoluteUrl ?? `${config.baseUrl}${endpoint}`;
  const body = JSON.stringify({
    applicationId: config.applicationId,
    password: config.password,
    ...payload,
  });

  const maxAttempts = options.noRetry ? 1 : config.maxRetries + 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await request<T>(url, body);

      if (data.statusCode === "S1000") return data;
      if (options.benignCodes?.includes(data.statusCode)) return data;

      const error = new IdeamartError(
        data.statusCode,
        data.statusDetail,
        endpoint,
        data
      );
      if (error.retryable && attempt < maxAttempts) {
        lastError = error;
        await sleep(backoff(attempt));
        continue;
      }
      throw error;
    } catch (err) {
      if (err instanceof IdeamartError) throw err;
      // Transport failure — retryable, but see the warning in debit().
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new IdeamartTransportError(
        `Request to ${endpoint} failed: ${(err as Error).message}`,
        endpoint,
        err
      );
    }
  }

  throw lastError;
}

/** Exponential backoff with jitter. */
function backoff(attempt: number): number {
  return Math.min(2 ** attempt * 250, 4000) + Math.random() * 250;
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
        timeout: config.timeoutMs,
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
            reject(new Error(`Non-JSON response (HTTP ${res.statusCode}): ${text.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timed out after ${config.timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/* ── SMS ─────────────────────────────────────────────────────────────────── */

export interface SendSmsOptions {
  sourceAddress?: string;
  requestDeliveryReport?: boolean;
  encoding?: SmsEncoding;
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
    throw new Error(
      "[ideamart] Use broadcastSms() for tel:all — broadcasts must be deliberate."
    );
  }
  return post<SmsSendResponse>(config.endpoints.smsSend, {
    version: config.apiVersion,
    destinationAddresses: recipients,
    message,
    ...(options.sourceAddress ?? config.sms.sourceAddress
      ? { sourceAddress: options.sourceAddress ?? config.sms.sourceAddress }
      : {}),
    deliveryStatusRequest: options.requestDeliveryReport
      ? "1"
      : config.sms.deliveryStatusRequest,
    ...(options.encoding ? { encoding: options.encoding } : {}),
    ...(options.chargingAmount ? { chargingAmount: options.chargingAmount } : {}),
  });
}

/**
 * Send to the ENTIRE subscribed base.
 *
 * Deliberately separate from sendSms and deliberately awkward to call. Check
 * queryBase() first, and put an authorisation check in front of this.
 */
export function broadcastSms(
  message: string,
  confirmation: "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS",
  options: SendSmsOptions = {}
): Promise<SmsSendResponse> {
  if (confirmation !== "I_HAVE_VERIFIED_THIS_GOES_TO_ALL_SUBSCRIBERS") {
    throw new Error("[ideamart] Broadcast confirmation token missing");
  }
  return post<SmsSendResponse>(config.endpoints.smsSend, {
    version: config.apiVersion,
    destinationAddresses: ["tel:all"],
    message,
    ...(options.sourceAddress ?? config.sms.sourceAddress
      ? { sourceAddress: options.sourceAddress ?? config.sms.sourceAddress }
      : {}),
    deliveryStatusRequest: "0",
  });
}

/* ── USSD ────────────────────────────────────────────────────────────────── */

/**
 * Send a USSD screen.
 *
 * `sessionId` MUST be the one the platform sent you. Use "mt-fin" for the
 * final screen — anything else leaves the session hanging.
 */
export function sendUssd(input: {
  sessionId: string;
  destinationAddress: string;
  message: string;
  operation: "mt-init" | "mt-cont" | "mt-fin";
}): Promise<UssdSendResponse> {
  return post<UssdSendResponse>(config.endpoints.ussdSend, {
    version: config.apiVersion,
    message: input.message,
    sessionId: input.sessionId,
    ussdOperation: input.operation,
    destinationAddress: toTelAddress(input.destinationAddress),
    encoding: "440",
  });
}

/* ── Subscription ────────────────────────────────────────────────────────── */

/**
 * Opt a subscriber in.
 *
 * Only call this with recorded, explicit consent. E1351 (already registered)
 * is accepted as success.
 */
export function register(subscriberId: string): Promise<SubscriptionSendResponse> {
  return post<SubscriptionSendResponse>(
    config.endpoints.subscriptionSend,
    {
      version: config.apiVersion,
      action: "1",
      subscriberId: toTelAddress(subscriberId),
    },
    { benignCodes: [BENIGN.register] }
  );
}

/**
 * Opt a subscriber out. E1356 (not registered) is accepted as success — the
 * desired end state already holds.
 */
export function unregister(subscriberId: string): Promise<SubscriptionSendResponse> {
  return post<SubscriptionSendResponse>(
    config.endpoints.subscriptionSend,
    {
      version: config.apiVersion,
      action: "0",
      subscriberId: toTelAddress(subscriberId),
    },
    { benignCodes: [BENIGN.unregister] }
  );
}

/** Check one subscriber's status. For reconciliation, not per-request gating. */
export function getSubscriptionStatus(
  subscriberId: string
): Promise<SubscriptionStatusResponse> {
  return post<SubscriptionStatusResponse>(config.endpoints.subscriptionStatus, {
    subscriberId: toTelAddress(subscriberId),
  });
}

/**
 * Subscriber base size. Cheap, subscriber-free — also the best connectivity
 * smoke test. Returns a parsed number alongside the raw response.
 */
export async function queryBase(): Promise<QueryBaseResponse & { size: number }> {
  const res = await post<QueryBaseResponse>(config.endpoints.subscriptionQueryBase, {});
  return { ...res, size: Number.parseInt(res.baseSize ?? "0", 10) };
}

/* ── OTP ─────────────────────────────────────────────────────────────────── */

/**
 * Send an OTP to a plain mobile number.
 *
 * Rate-limit this per number AND per IP before calling, or your app becomes an
 * SMS-bombing tool. Keep the returned referenceNo server-side.
 */
export function requestOtp(input: {
  subscriberId: string;
  metaData: OtpApplicationMetaData;
  applicationHash?: string;
}): Promise<OtpRequestResponse> {
  return post<OtpRequestResponse>(config.endpoints.otpRequest, {
    subscriberId: toTelAddress(input.subscriberId),
    applicationHash: input.applicationHash ?? randomUUID(),
    applicationMetaData: input.metaData,
  });
}

/**
 * Verify an OTP. Valid 60 minutes, maximum 3 attempts — enforce those limits
 * on your side too. The returned subscriberId is the masked identifier to use
 * for every subsequent API call.
 */
export function verifyOtp(input: {
  referenceNo: string;
  otp: string;
}): Promise<OtpVerifyResponse> {
  return post<OtpVerifyResponse>(config.endpoints.otpVerify, {
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
 * - Retries are disabled. A timeout does NOT mean the charge failed. Resolve
 *   unknown outcomes by re-calling with the SAME externalTrxId, or by
 *   reconciling against the charging notification. Never re-roll the ID.
 * - E1379 (already completed) is accepted as success.
 */
export function debit(input: {
  subscriberId: string;
  amount: string;
  externalTrxId: string;
  currency?: string;
  accountId?: string;
  paymentInstrument?: string;
}): Promise<DirectDebitResponse> {
  if (!input.externalTrxId) {
    throw new Error("[ideamart] externalTrxId is required and must be persisted first");
  }
  if (input.externalTrxId.length > 32) {
    throw new Error("[ideamart] externalTrxId must be 32 characters or fewer");
  }
  return post<DirectDebitResponse>(
    config.endpoints.caasDirectDebit,
    {
      externalTrxId: input.externalTrxId,
      subscriberId: toTelAddress(input.subscriberId),
      amount: input.amount,
      currency: input.currency ?? "LKR",
      ...(input.accountId ? { accountId: input.accountId } : {}),
      ...(input.paymentInstrument ? { paymentInstrument: input.paymentInstrument } : {}),
    },
    { noRetry: true, benignCodes: [BENIGN.debit] }
  );
}

/**
 * Query chargeable balance. Sri Lanka only — unavailable for Smart (Cambodia),
 * so it is gated on config.
 *
 * Advisory only: the balance can change before the debit lands. Always handle
 * E1378 on the debit regardless of what this returned.
 */
export function queryBalance(input: {
  subscriberId: string;
  accountId?: string;
  currency?: string;
}): Promise<BalanceQueryResponse> {
  if (!config.caas.balanceQueryEnabled) {
    throw new Error(
      "[ideamart] Balance query is disabled (IDEAMART_BALANCE_QUERY_ENABLED). " +
        "It is not available for Smart/Cambodia."
    );
  }
  return post<BalanceQueryResponse>(config.endpoints.caasBalanceQuery, {
    subscriberId: toTelAddress(input.subscriberId),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    currency: input.currency ?? "LKR",
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
export async function locate(
  input: Omit<LbsLocateRequest, "applicationId" | "password">
): Promise<LbsLocateResponse> {
  return post<LbsLocateResponse>(
    "/lbs/locate",
    {
      version: input.version ?? config.apiVersion,
      subscriberId: toTelAddress(input.subscriberId),
      serviceType: input.serviceType,
      ...(input.responseTime ? { responseTime: input.responseTime } : {}),
      ...(input.horizontalAccuracy ? { horizontalAccuracy: input.horizontalAccuracy } : {}),
      ...(input.freshness ? { freshness: input.freshness } : {}),
    },
    { absoluteUrl: config.lbsUrl }
  );
}

/* ── Extension point ─────────────────────────────────────────────────────── */

/**
 * Adding a new Ideamart service (IVR, or anything published later):
 *
 *   1. Add the path to `endpoints` in ideamart-config.ts
 *   2. Add request/response interfaces to ideamart-types.ts
 *   3. Add one wrapper here:
 *
 *        export function placeIvrCall(input: IvrCallInput): Promise<IvrCallResponse> {
 *          return post<IvrCallResponse>(config.endpoints.ivrCall, { ...input });
 *        }
 *
 * It inherits credential injection, timeouts, retries, error mapping and
 * logging for free. Do not build a parallel client.
 */
