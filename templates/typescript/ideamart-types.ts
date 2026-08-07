/**
 * Ideamart request/response types.
 *
 * Field names and optionality follow the official documentation at
 * https://docs.ideamart.io/developer-docs/. Note that Ideamart sends numbers
 * as strings (baseSize, amount, chargeableBalance, latitude, longitude) —
 * the types reflect the wire format, not what you wish it were. Parse at the
 * boundary.
 */

/* ── Common ──────────────────────────────────────────────────────────────── */

/** Every Ideamart response carries at least these. */
export interface IdeamartBaseResponse {
  statusCode: string;
  statusDetail: string;
  version?: string;
  requestId?: string;
}

/** Credentials injected by the client — never build these at a call site. */
export interface IdeamartCredentials {
  applicationId: string;
  password: string;
}

/**
 * A subscriber address. Always `tel:`-prefixed. May be a plain MSISDN
 * (`tel:94771234567`) or, when number masking is enabled for the app, an
 * opaque hash (`tel:hu3b84346f…`). Treat it as opaque either way.
 */
export type TelAddress = `tel:${string}`;

/** SMS broadcast to the entire subscribed base. Guard its use. */
export const BROADCAST_ADDRESS = "tel:all" as const;

/* ── SMS ─────────────────────────────────────────────────────────────────── */

export type SmsEncoding = "0" | "240" | "245"; // Text | Flash | Binary (hex)

export interface SmsSendRequest extends IdeamartCredentials {
  version?: string;
  /** Always an array, even for a single recipient. */
  destinationAddresses: string[];
  message: string;
  /** Must be a provisioned alias, or the send fails with E1331. */
  sourceAddress?: string;
  /** "0" = not required, "1" = required. */
  deliveryStatusRequest?: "0" | "1";
  encoding?: SmsEncoding;
  chargingAmount?: string;
}

export interface SmsDestinationResponse {
  address?: string;
  messageId?: string;
  statusDetail?: string;
  timeStamp?: string;
}

export interface SmsSendResponse extends IdeamartBaseResponse {
  messageId?: string;
  /** Per-recipient results. A multi-recipient send can partially succeed. */
  destinationResponses?: SmsDestinationResponse[];
}

/** Inbound: MO SMS — what the platform POSTs to your callback URL. */
export interface MoSmsCallback {
  version: string;
  applicationId: string;
  sourceAddress: string;
  message: string;
  requestId: string;
  encoding: SmsEncoding;
}

/**
 * Delivery status. Ideamart→app uses the long forms; the underlying SMPP
 * gateway uses the abbreviated ones. Accept both and normalise on the way in.
 */
export type DeliveryStatus =
  | "DELIVERED" | "EXPIRED" | "DELETED" | "UNDELIVERABLE"
  | "ACCEPTED" | "UNKNOWN" | "REJECTED"
  | "DELIVRD" | "UNDELIV" | "ACCEPTD" | "REJECTD";

/** Inbound: delivery report. */
export interface DeliveryReportCallback {
  destinationAddress: string;
  /** Documented as yyMMddHHmm; samples show yyyyMMddHHmmss. Parse leniently. */
  timeStamp: string;
  /** Matches the requestId/messageId from the original send. */
  requestId: string;
  deliveryStatus: DeliveryStatus;
}

/* ── USSD ────────────────────────────────────────────────────────────────── */

/** Set by the platform on inbound; set by your app on outbound. */
export type UssdOperation =
  | "mo-init"  // platform: subscriber started a session
  | "mo-cont"  // platform: subscriber replied
  | "mt-init"  // app: app-initiated session
  | "mt-cont"  // app: next screen, session stays open
  | "mt-fin";  // app: final screen, session closes

export interface UssdSendRequest extends IdeamartCredentials {
  version?: string;
  message: string;
  /** Echo the sessionId the platform gave you. Never generate your own. */
  sessionId: string;
  ussdOperation: Extract<UssdOperation, "mt-init" | "mt-cont" | "mt-fin">;
  destinationAddress: string;
  /** "440" = plain ASCII. */
  encoding?: "440";
}

export interface UssdSendResponse extends IdeamartBaseResponse {
  timeStamp?: string;
}

/** Inbound: USSD keypress or session start. */
export interface UssdReceiveCallback {
  version: string;
  applicationId: string;
  sessionId: string;
  ussdOperation: Extract<UssdOperation, "mo-init" | "mo-cont">;
  sourceAddress: string;
  vlrAddress?: string;
  message: string;
  encoding: string;
  requestId: string;
}

/* ── Subscription ────────────────────────────────────────────────────────── */

/** "1" = opt in (register), "0" = opt out (unregister). */
export type SubscriptionAction = "1" | "0";

export type SubscriptionStatus =
  | "REGISTERED" | "UNREGISTERED" | "PENDING" | "CHARGE";

export interface SubscriptionSendRequest extends IdeamartCredentials {
  version?: string;
  action: SubscriptionAction;
  subscriberId: string;
}

export interface SubscriptionSendResponse extends IdeamartBaseResponse {
  subscriptionStatus?: SubscriptionStatus;
}

export interface SubscriptionStatusRequest extends IdeamartCredentials {
  subscriberId: string;
}

export interface SubscriptionStatusResponse extends IdeamartBaseResponse {
  subscriptionStatus?: SubscriptionStatus;
}

export interface QueryBaseRequest extends IdeamartCredentials {}

export interface QueryBaseResponse extends IdeamartBaseResponse {
  /** Subscriber base size — arrives as a string. Coerce before arithmetic. */
  baseSize?: string;
}

/** Inbound: subscription notification. The authoritative source of state. */
export interface SubscriptionNotificationCallback {
  applicationId: string;
  subscriberId: string;
  status: "REGISTERED" | "UNREGISTERED";
  frequency?: string;
  version: string;
  timeStamp: string;
}

/* ── OTP ─────────────────────────────────────────────────────────────────── */

export type OtpClient = "MOBILEAPP" | "WebSite" | "DESKTOP";

export interface OtpApplicationMetaData {
  client: OtpClient;
  device: string;
  os: string;
  /** App: package name or store URL. Web: page URL. Desktop: download URL. */
  appCode: string;
}

export interface OtpRequestInput extends IdeamartCredentials {
  subscriberId: string;
  /** A UUID you generate per request, for tracing. */
  applicationHash?: string;
  applicationMetaData?: OtpApplicationMetaData;
}

export interface OtpRequestResponse extends IdeamartBaseResponse {
  /** Keep server-side, in the session. Never send to the client. */
  referenceNo?: string;
}

export interface OtpVerifyInput extends IdeamartCredentials {
  referenceNo: string;
  otp: string;
}

export interface OtpVerifyResponse extends IdeamartBaseResponse {
  subscriptionStatus?: SubscriptionStatus;
  /** The masked subscriberId to use for every subsequent API call. */
  subscriberId?: string;
}

/* ── CaaS ────────────────────────────────────────────────────────────────── */

export interface DirectDebitRequest extends IdeamartCredentials {
  /** Your idempotency key. Persist BEFORE calling. Max 32 chars. */
  externalTrxId: string;
  subscriberId: string;
  /** Sent as a string. Hold it as a decimal type in your own code. */
  amount: string;
  paymentInstrument?: string;
  accountId?: string;
  currency?: string;
}

export interface DirectDebitResponse extends IdeamartBaseResponse {
  externalTrxId?: string;
  /** Payment gateway's ID. Persist it — support traces with this. */
  internalTrxId?: string;
  referenceId?: string;
  /** ISO-8601. */
  timeStamp?: string;
  shortDescription?: string;
  longDescription?: string;
}

export interface BalanceQueryRequest extends IdeamartCredentials {
  subscriberId: string;
  accountId?: string;
  currency?: string;
}

export interface BalanceQueryResponse extends IdeamartBaseResponse {
  /** String. Parse as decimal, never as a float you compare for equality. */
  chargeableBalance?: string;
  accountType?: string;
  accountStatus?: string;
}

/** Inbound: charging notification — your reconciliation channel. */
export interface ChargingNotificationCallback {
  applicationId?: string;
  externalTrxId?: string;
  internalTrxId?: string;
  subscriberId?: string;
  amount?: string;
  currency?: string;
  statusCode?: string;
  statusDetail?: string;
  timeStamp?: string;
  version?: string;
}

/* ── LBS ─────────────────────────────────────────────────────────────────── */

export type LbsServiceType = "IMMEDIATE";
export type LbsResponseTime = "NO_DELAY" | "LOW_DELAY" | "DELAY_TOLERANCE";
export type LbsHorizontalAccuracy = "100" | "500" | "1000" | "1500";
export type LbsFreshness = "HIGH_LOW" | "LOW_HIGH" | "HIGH" | "LOW";

export interface LbsLocateRequest extends IdeamartCredentials {
  version?: string;
  /** One subscriber per request. */
  subscriberId: string;
  serviceType: LbsServiceType;
  /**
   * QoS fields are capped by your provisioning — you may request your level
   * or weaker, never stronger (E1367). Omit them to use the provisioned
   * defaults, which is the safest choice.
   */
  responseTime?: LbsResponseTime;
  horizontalAccuracy?: LbsHorizontalAccuracy;
  freshness?: LbsFreshness;
}

export interface LbsLocateResponse extends IdeamartBaseResponse {
  messageId?: string;
  /** String; absent on failure. Sanity-check against the expected region. */
  latitude?: string;
  longitude?: string;
  /** Age of the fix, in minutes. */
  freshness?: string;
  /** Accuracy radius, in metres. Treat the position as a circle. */
  horizontalAccuracy?: string;
  /** Handset power state. */
  subscriberState?: boolean;
  timeStamp?: string;
}
