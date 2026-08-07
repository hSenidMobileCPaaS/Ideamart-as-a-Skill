/**
 * Ideamart configuration — the ONLY module that reads process.env.
 *
 * Two credentials, plus one URL per service you provisioned. Nothing else is
 * configuration: timeouts and encodings are constants in the client, because
 * they are properties of the protocol rather than of your deployment.
 *
 * An endpoint that is not set means that API is not enabled on your
 * application. The client refuses to call it, so you get a clear local error
 * instead of E1309 from the platform.
 *
 * Validation runs at import time, so a misconfigured deployment fails at boot
 * rather than under load.
 *
 * SERVER-SIDE ONLY. Importing this into client code would bundle the password
 * into something a user can read.
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

/** An endpoint is optional: absent means that API is not provisioned. */
function endpoint(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim().replace(/\/+$/, "") : undefined;
}

export const config = {
  /** Never log these. Never send them to a client. */
  applicationId: requireEnv("IDEAMART_APP_ID"),
  password: requireEnv("IDEAMART_PASSWORD"),

  /**
   * Only the services enabled on your application. Point any of these at a
   * local mock during development — that is the whole environment switch.
   */
  endpoints: {
    smsSend: endpoint("IDEAMART_SMS_SEND_URL"),
    ussdSend: endpoint("IDEAMART_USSD_SEND_URL"),
    subscriptionSend: endpoint("IDEAMART_SUBSCRIPTION_SEND_URL"),
    subscriptionStatus: endpoint("IDEAMART_SUBSCRIPTION_STATUS_URL"),
    subscriptionQueryBase: endpoint("IDEAMART_SUBSCRIPTION_QUERY_BASE_URL"),
    otpRequest: endpoint("IDEAMART_OTP_REQUEST_URL"),
    otpVerify: endpoint("IDEAMART_OTP_VERIFY_URL"),
    caasDebit: endpoint("IDEAMART_CAAS_DEBIT_URL"),
    caasBalance: endpoint("IDEAMART_CAAS_BALANCE_URL"),
    lbsLocate: endpoint("IDEAMART_LBS_URL"),
  },
} as const;

export type ServiceName = keyof typeof config.endpoints;

/**
 * Resolve an endpoint, or fail with a message that names the missing variable.
 *
 * This is the guard that keeps you from calling an API your application was
 * never provisioned for.
 */
export function requireEndpoint(service: ServiceName): string {
  const url = config.endpoints[service];
  if (!url) {
    throw new Error(
      `[ideamart] ${service} is not configured. Either the API is not enabled on ` +
        `your application in IdeaPro, or its URL is missing from the environment. ` +
        `See .env.example.`
    );
  }
  return url;
}

/** Which services this deployment can actually call. Useful at startup. */
export function enabledServices(): ServiceName[] {
  return (Object.keys(config.endpoints) as ServiceName[]).filter(
    (s) => config.endpoints[s] !== undefined
  );
}

/** Redacted view, safe to log at startup to confirm what the process loaded. */
export function describeConfig(): Record<string, unknown> {
  return {
    applicationId: config.applicationId,
    password: "***redacted***",
    enabledServices: enabledServices(),
  };
}
