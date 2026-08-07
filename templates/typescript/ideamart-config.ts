/**
 * Ideamart configuration — the ONLY module that reads process.env.
 *
 * Everything else imports `config` from here. That gives you one place to
 * audit for credential handling, and one place to change when the deployment
 * target changes.
 *
 * Validation happens at import time, so a misconfigured deployment fails at
 * boot with a clear message instead of returning E1313 under load.
 *
 * SERVER-SIDE ONLY. Importing this into client-side code would bundle the
 * password into something a user can read.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `[ideamart] Missing required environment variable ${name}.\n` +
        `Copy .env.example to .env and fill in your Ideamart credentials.\n` +
        `In production, set it in your host's secret manager.`
    );
  }
  return value.trim();
}

function optionalEnv(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`[ideamart] ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

/* ── TLS ─────────────────────────────────────────────────────────────────── */

const insecureTls =
  optionalEnv("IDEAMART_INSECURE_TLS") === "yes-i-understand-the-risk";

if (insecureTls && process.env.NODE_ENV === "production") {
  throw new Error(
    "[ideamart] IDEAMART_INSECURE_TLS must never be set in production. " +
      "Disabling certificate verification exposes your applicationId and " +
      "password to interception. Supply IDEAMART_CA_BUNDLE_PATH instead."
  );
}

if (insecureTls) {
  console.warn(
    "[ideamart] TLS certificate verification is DISABLED. " +
      "Development only — never deploy this."
  );
}

/* ── Config ──────────────────────────────────────────────────────────────── */

export const config = {
  /** Credentials. Never log these. Never send them to a client. */
  applicationId: requireEnv("IDEAMART_APP_ID"),
  password: requireEnv("IDEAMART_PASSWORD"),

  /** Base URL — swap this to point at a local mock. */
  baseUrl: optionalEnv("IDEAMART_BASE_URL", "https://api.ideamart.io").replace(
    /\/+$/,
    ""
  ),

  /** LBS is on a different host, so it is a full URL rather than a path. */
  lbsUrl: optionalEnv("IDEAMART_LBS_URL", "https://api.dialog.lk/lbs/locate"),

  apiVersion: optionalEnv("IDEAMART_API_VERSION", "1.0"),
  timeoutMs: numberEnv("IDEAMART_TIMEOUT_MS", 15_000),
  maxRetries: numberEnv("IDEAMART_MAX_RETRIES", 2),

  sms: {
    /** Must be a provisioned alias, or sends fail with E1331. */
    sourceAddress: optionalEnv("IDEAMART_SMS_SOURCE_ADDRESS") || undefined,
    /** "0" = no delivery report, "1" = request one. */
    deliveryStatusRequest: optionalEnv("IDEAMART_SMS_DELIVERY_REPORT", "0"),
  },

  caas: {
    /** Mirrors the "Enable Query Balance Requests" CaaS provisioning toggle. */
    balanceQueryEnabled: boolEnv("IDEAMART_BALANCE_QUERY_ENABLED", true),
  },

  tls: {
    caBundlePath: optionalEnv("IDEAMART_CA_BUNDLE_PATH") || undefined,
    insecure: insecureTls,
  },

  callbacks: {
    /** Ideamart egress IPs allowed to POST to your callback routes. */
    allowedIps: optionalEnv("IDEAMART_CALLBACK_ALLOWED_IPS")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  },

  /**
   * Endpoint paths, relative to baseUrl.
   *
   * Adding a new Ideamart service means adding a line here and one wrapper
   * method on the client — never a new HTTP call at a call site.
   */
  endpoints: {
    smsSend: "/sms/send",
    ussdSend: "/ussd/send",
    subscriptionSend: "/subscription/send",
    subscriptionStatus: "/subscription/getStatus",
    subscriptionQueryBase: "/subscription/query-base",
    otpRequest: "/subscription/otp/request",
    otpVerify: "/subscription/otp/verify",
    caasDirectDebit: "/caas/direct/debit",
    caasBalanceQuery: "/caas/balance/query",
  },
} as const;

export type IdeamartConfig = typeof config;

/**
 * Redacted view, safe to log at startup so you can confirm what the process
 * actually loaded without leaking the secret.
 */
export function describeConfig(): Record<string, unknown> {
  return {
    applicationId: config.applicationId,
    password: "***redacted***",
    baseUrl: config.baseUrl,
    apiVersion: config.apiVersion,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    balanceQueryEnabled: config.caas.balanceQueryEnabled,
    tlsInsecure: config.tls.insecure,
  };
}
