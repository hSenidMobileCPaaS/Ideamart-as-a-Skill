/**
 * Ideamart callback (inbound webhook) handlers.
 *
 * Written for the Next.js App Router — split each exported handler into its own
 * `app/api/ideamart/<name>/route.ts`. The logic is framework-agnostic: the same
 * five handlers port directly to Express, Fastify, Hono, NestJS or anything
 * else that gives you a JSON body and a JSON response.
 *
 * Routes to register in the IdeaPro portal:
 *   MO SMS                    POST /api/ideamart/sms/mo
 *   Delivery report           POST /api/ideamart/sms/dlr
 *   USSD receive              POST /api/ideamart/ussd
 *   Subscription notification POST /api/ideamart/subscription/notification
 *   Charging notification     POST /api/ideamart/charging/notification
 *
 * The contract, for all five:
 *   - Respond { "statusCode": "S1000", "statusDetail": "Success" }
 *   - Respond FIRST, work afterwards
 *   - Always HTTP 200, even for payloads you reject
 *   - Be idempotent — every callback can arrive more than once
 *   - Never trust the body; it is unauthenticated JSON from the internet
 */

import { NextRequest, NextResponse } from "next/server";
import { config } from "./ideamart-config";
import { maskAddress, sendUssd } from "./ideamart-client";
import { getSession, setSession, endSession } from "./ussd-session";
import type {
  ChargingNotificationCallback,
  DeliveryReportCallback,
  MoSmsCallback,
  SubscriptionNotificationCallback,
  UssdReceiveCallback,
} from "./ideamart-types";

/** The only response Ideamart expects. */
const ACK = { statusCode: "S1000", statusDetail: "Success" } as const;
const ack = () => NextResponse.json(ACK);

/* ── Shared guards ───────────────────────────────────────────────────────── */

/**
 * Restrict to Ideamart's egress IPs. Ideamart signs nothing, so there is no
 * signature to verify — source IP is the strongest control available.
 *
 * Ask Ideamart support for the current list and fill this in. Prefer enforcing
 * it at the firewall or load balancer if you can; this is the fallback for when
 * you cannot.
 */
const IDEAMART_SOURCE_IPS: string[] = [
  // "203.0.113.10",
];

function isAllowedSource(req: NextRequest): boolean {
  if (IDEAMART_SOURCE_IPS.length === 0) return true; // not configured yet
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim();
  return Boolean(ip) && IDEAMART_SOURCE_IPS.includes(ip);
}

/** Reject payloads addressed to a different application. Cheap noise filter. */
function isOurApp(applicationId: unknown): boolean {
  return applicationId === config.applicationId;
}

/**
 * Deduplication. Replace with Redis (SETNX + TTL) or a unique DB constraint in
 * production — an in-process Set does not survive a restart or a second
 * instance, which is exactly when duplicates arrive.
 */
const seen = new Set<string>();
function isDuplicate(key: string): boolean {
  if (seen.has(key)) return true;
  seen.add(key);
  setTimeout(() => seen.delete(key), 10 * 60_000).unref?.();
  return false;
}

/** Read the JSON body without throwing on malformed input. */
async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Hand work to a queue. Replace with your real queue (BullMQ, SQS, Pub/Sub).
 * The point is that the HTTP response does not wait for it.
 */
function enqueue(job: string, payload: unknown): void {
  void Promise.resolve().then(async () => {
    try {
      await handleJob(job, payload);
    } catch (err) {
      console.error("[ideamart] job failed", { job, err });
      // Send to a dead-letter queue here.
    }
  });
}

/* ── 1. MO SMS ───────────────────────────────────────────────────────────── */
// app/api/ideamart/sms/mo/route.ts

export async function moSmsHandler(req: NextRequest) {
  if (!isAllowedSource(req)) return ack();

  const body = await readJson(req);
  if (!body || !isOurApp(body.applicationId)) return ack();

  const payload = body as unknown as MoSmsCallback;
  if (!payload.requestId || typeof payload.message !== "string") return ack();
  if (isDuplicate(`mo:${payload.requestId}`)) return ack();

  console.info("[ideamart] mo-sms", {
    requestId: payload.requestId,
    from: maskAddress(payload.sourceAddress),
    // Message content deliberately not logged — it is user communication.
  });

  enqueue("sms.mo", payload);
  return ack();
}

/* ── 2. SMS delivery report ──────────────────────────────────────────────── */
// app/api/ideamart/sms/dlr/route.ts

/** Ideamart and the SMPP gateway use different spellings. Normalise both. */
const DELIVERY_STATUS: Record<string, string> = {
  DELIVRD: "DELIVERED", UNDELIV: "UNDELIVERABLE",
  ACCEPTD: "ACCEPTED", REJECTD: "REJECTED",
};

export async function deliveryReportHandler(req: NextRequest) {
  if (!isAllowedSource(req)) return ack();

  const body = await readJson(req);
  if (!body) return ack();

  const payload = body as unknown as DeliveryReportCallback;
  if (!payload.requestId || !payload.deliveryStatus) return ack();

  const status = DELIVERY_STATUS[payload.deliveryStatus] ?? payload.deliveryStatus;
  if (isDuplicate(`dlr:${payload.requestId}:${status}`)) return ack();

  console.info("[ideamart] delivery-report", {
    requestId: payload.requestId,
    status,
    to: maskAddress(payload.destinationAddress),
  });

  enqueue("sms.dlr", { ...payload, deliveryStatus: status });
  return ack();
}

/**
 * Timestamps arrive as either yyMMddHHmm (10) or yyyyMMddHHmmss (14).
 * Parse both; return null rather than an Invalid Date.
 */
export function parseIdeamartTimestamp(raw: string): Date | null {
  if (/^\d{14}$/.test(raw)) {
    const [, y, mo, d, h, mi, s] =
      raw.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)!;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
  }
  if (/^\d{10}$/.test(raw)) {
    const [, y, mo, d, h, mi] = raw.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)!;
    return new Date(Date.UTC(2000 + +y, +mo - 1, +d, +h, +mi));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ── 3. USSD receive ─────────────────────────────────────────────────────── */
// app/api/ideamart/ussd/route.ts

/**
 * The response body here is ONLY an acknowledgement. The screen the user sees
 * comes from a separate POST /ussd/send — which is why the reply is enqueued
 * rather than returned.
 *
 * USSD sessions time out in seconds. Do nothing slow before acking.
 */
export async function ussdHandler(req: NextRequest) {
  if (!isAllowedSource(req)) return ack();

  const body = await readJson(req);
  if (!body || !isOurApp(body.applicationId)) return ack();

  const payload = body as unknown as UssdReceiveCallback;
  if (!payload.sessionId || !payload.sourceAddress) return ack();
  if (isDuplicate(`ussd:${payload.requestId}`)) return ack();

  console.info("[ideamart] ussd", {
    sessionId: payload.sessionId,
    operation: payload.ussdOperation,
    from: maskAddress(payload.sourceAddress),
  });

  enqueue("ussd.receive", payload);
  return ack();
}

/** The menu logic, run out of band. Replies via sendUssd(). */
async function handleUssdInput(payload: UssdReceiveCallback): Promise<void> {
  const { sessionId, sourceAddress, message, ussdOperation } = payload;

  if (ussdOperation === "mo-init") {
    setSession(sessionId, { node: "root", sourceAddress });
    await sendUssd({
      sessionId,
      destinationAddress: sourceAddress,
      operation: "mt-cont",
      message: "Welcome to Acme\n1. Balance\n2. Support\n0. Exit",
    });
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    // Expired or unknown — close cleanly rather than leaving it hanging.
    await sendUssd({
      sessionId,
      destinationAddress: sourceAddress,
      operation: "mt-fin",
      message: "Session expired. Please dial again.",
    });
    return;
  }

  const input = message.trim();

  // Terminal screens MUST use mt-fin, or the session hangs until the network
  // times it out.
  if (input === "0") {
    endSession(sessionId);
    await sendUssd({
      sessionId,
      destinationAddress: sourceAddress,
      operation: "mt-fin",
      message: "Thank you.",
    });
    return;
  }

  if (input === "1") {
    endSession(sessionId);
    await sendUssd({
      sessionId,
      destinationAddress: sourceAddress,
      operation: "mt-fin",
      message: "Your balance is Rs. 300.00",
    });
    return;
  }

  if (input === "2") {
    setSession(sessionId, { ...session, node: "support" });
    await sendUssd({
      sessionId,
      destinationAddress: sourceAddress,
      operation: "mt-cont",
      message: "Support\n1. Call us\n2. SMS us\n0. Exit",
    });
    return;
  }

  // Invalid input: reshow rather than dropping the session.
  await sendUssd({
    sessionId,
    destinationAddress: sourceAddress,
    operation: "mt-cont",
    message: "Invalid option\n1. Balance\n2. Support\n0. Exit",
  });
}

/* ── 4. Subscription notification ────────────────────────────────────────── */
// app/api/ideamart/subscription/notification/route.ts

/**
 * The authoritative source of subscription state — including changes you did
 * not initiate (a user texting STOP, an operator removal, a billing failure).
 * Consuming this is what lets you keep a local mirror instead of polling
 * getStatus.
 */
export async function subscriptionNotificationHandler(req: NextRequest) {
  if (!isAllowedSource(req)) return ack();

  const body = await readJson(req);
  if (!body || !isOurApp(body.applicationId)) return ack();

  const payload = body as unknown as SubscriptionNotificationCallback;
  if (!payload.subscriberId || !payload.status) return ack();
  if (isDuplicate(`sub:${payload.subscriberId}:${payload.status}:${payload.timeStamp}`)) {
    return ack();
  }

  console.info("[ideamart] subscription-notification", {
    subscriber: maskAddress(payload.subscriberId),
    status: payload.status,
    frequency: payload.frequency,
  });

  enqueue("subscription.notification", payload);
  return ack();
}

/* ── 5. Charging notification ────────────────────────────────────────────── */
// app/api/ideamart/charging/notification/route.ts

/**
 * Your reconciliation channel. Every charge left in UNKNOWN after a timeout
 * gets resolved here. Idempotency is not optional — a duplicate that
 * double-counts revenue is a real bug with real consequences.
 *
 * The payload mirrors the Direct Debit response: the same transaction
 * identifiers carrying the final outcome. Read what you need, ignore anything
 * else, and log the raw body on your first Limited Production charge so you can
 * widen the handler if your account sends extra fields.
 */
export async function chargingNotificationHandler(req: NextRequest) {
  if (!isAllowedSource(req)) return ack();

  const body = await readJson(req);
  if (!body) return ack();

  const payload = body as unknown as ChargingNotificationCallback;
  const key = payload.externalTrxId ?? payload.internalTrxId;
  if (!key) return ack();
  if (isDuplicate(`charge:${key}:${payload.statusCode}`)) return ack();

  console.info("[ideamart] charging-notification", {
    externalTrxId: payload.externalTrxId,
    internalTrxId: payload.internalTrxId,
    statusCode: payload.statusCode,
    subscriber: payload.subscriberId ? maskAddress(payload.subscriberId) : undefined,
  });

  enqueue("charging.notification", payload);
  return ack();
}

/* ── Job dispatch ────────────────────────────────────────────────────────── */

async function handleJob(job: string, payload: unknown): Promise<void> {
  switch (job) {
    case "ussd.receive":
      return handleUssdInput(payload as UssdReceiveCallback);

    case "sms.mo":
      // Honour opt-out keywords, then handle your own commands.
      // const { message, sourceAddress } = payload as MoSmsCallback;
      // if (/^\s*(stop|unsub|off)\b/i.test(message)) await unregister(sourceAddress);
      return;

    case "sms.dlr":
      // Persist the latest status keyed by requestId.
      return;

    case "subscription.notification":
      // Upsert your local subscription mirror.
      return;

    case "charging.notification":
      // Reconcile against your transaction ledger by externalTrxId.
      return;

    default:
      console.warn("[ideamart] unknown job", { job });
  }
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

/**
 * app/api/ideamart/ussd/route.ts
 *
 *   import { ussdHandler } from "@/lib/ideamart/callbacks";
 *   export const POST = ussdHandler;
 *   export const runtime = "nodejs";     // needs node:https for the client
 *   export const dynamic = "force-dynamic";
 *
 * Also make sure these routes are exempt from CSRF protection and from any
 * auth middleware — then rely on the Ideamart source-IP allowlist instead, or you
 * have left an open endpoint.
 */
