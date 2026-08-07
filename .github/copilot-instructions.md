# Ideamart Integration — Copilot Instructions

Ideamart is Dialog Axiata's telco platform for **Sri Lanka**, covering the operators Dialog,
Hutch (072 and 078) and Airtel. It exposes SMS, USSD, subscription management, mobile-account
charging and location as JSON-over-HTTPS APIs.

Full specifications: [`AGENTS.md`](../AGENTS.md) and [`references/`](../references/).
Working reference code: [`templates/typescript/`](../templates/typescript/).

## Rules

- `applicationId` and `password` come from environment variables, through one config module,
  validated at startup. Never hardcoded, never in a client bundle, never logged, never
  committed. Never prefixed `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_`.
- Ideamart is called from the backend only — the platform enforces IP whitelisting and the
  credentials are a shared secret.
- Record explicit consent before Register or any charge; disclose amount and frequency first.
- `subscriberId` is opaque; it may be a masked hash rather than a phone number.
- Charging needs one `externalTrxId` per logical charge, persisted before the call and reused
  on retry.

## Shape

`POST` JSON with `applicationId` + `password` + service fields. Response is HTTP 200 with
`statusCode` / `statusDetail`.

**HTTP 200 does not mean success** — branch on `statusCode`; `S1000` is success.

Addresses are `tel:`-prefixed, no `+`, no spaces. `destinationAddresses` is always an array.

## Endpoints

| Purpose | Endpoint |
|---|---|
| Send SMS | `POST /sms/send` |
| USSD screen | `POST /ussd/send` |
| Register / unregister | `POST /subscription/send` (`action` `"1"` / `"0"`) |
| Subscription status | `POST /subscription/getStatus` |
| Subscriber base size | `POST /subscription/query-base` |
| OTP request / verify | `POST /subscription/otp/request` / `/verify` |
| Charge | `POST /caas/direct/debit` |
| Balance (needs provisioning) | `POST /caas/balance/query` |
| Locate | `POST https://api.dialog.lk/lbs/locate` |

Callbacks (MO SMS, delivery report, USSD receive, subscription notification, charging
notification) return `{"statusCode":"S1000","statusDetail":"Success"}`, always HTTP 200,
acknowledging before doing work.

## Success codes that look like errors

`E1351` on Register, `E1356` on Unregister, `E1379` on a debit retry.

## Down-not-broken codes

`E1303` (IP not whitelisted), `E1313` (bad credentials), `E1309` (API not provisioned).

## Do not

Check only the HTTP status; send `destinationAddresses` as a string; generate your own USSD
`sessionId`; end a USSD flow with `mt-cont`; keep USSD sessions in an in-process `Map`; do work
before acknowledging a callback; ship `rejectUnauthorized: false`; log secrets or unmasked
subscriber addresses; invent IVR endpoints.
