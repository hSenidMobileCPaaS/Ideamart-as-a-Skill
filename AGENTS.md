# Ideamart Integration — Agent Instructions

> Portable entry point for Cursor, Windsurf, GitHub Copilot, Codex, Cline, Aider, Zed and any
> other agent that reads `AGENTS.md`. Claude Code and the Agent SDK use [SKILL.md](SKILL.md) —
> same content, skill frontmatter.

Ideamart is Axiata's telco platform (Dialog, Airtel, Hutch in Sri Lanka; Smart in Cambodia).
It exposes SMS, USSD, subscription management, mobile-account charging and location as
JSON-over-HTTPS APIs.

**Apply these instructions whenever the work involves Ideamart, IdeaPro, `api.ideamart.io`,
`tel:` MSISDN addressing, USSD menus, shortcode/keyword routing, subscriber base size,
direct carrier billing, or telco SMS in Sri Lanka or Cambodia.**

---

## Non-negotiable rules

1. **Never hardcode `applicationId` or `password`.** Environment variables only, read through
   one config module, validated at startup. Not in source, not in a client bundle, not in a
   committed file, not in a log, not in git history.
2. **Never call Ideamart from client-side code.** Browsers and mobile apps call *your*
   backend; your backend calls Ideamart. The credentials are a shared secret and the platform
   enforces IP whitelisting.
3. **Never subscribe or charge without explicit, recorded consent**, and never without
   disclosing amount and frequency first. Ideamart suspends applications over this.
4. **Never assume `subscriberId` is a real phone number.** With masking enabled it is an
   opaque hash. Store and send back exactly what you received.
5. **Always make charging idempotent.** One `externalTrxId` per logical charge, persisted
   *before* the call. Never retry with a fresh one — that double-charges a real person.

---

## Read before writing code

| Task | File |
|---|---|
| Account, provisioning, credentials, first call | [references/01-getting-started.md](references/01-getting-started.md) |
| Send / receive SMS, delivery reports | [references/02-sms.md](references/02-sms.md) |
| USSD sessions and menus | [references/03-ussd.md](references/03-ussd.md) |
| Register, **unregister**, status, **base size**, OTP | [references/04-subscription.md](references/04-subscription.md) |
| Charging: direct debit, balance query | [references/05-caas.md](references/05-caas.md) |
| LBS location; IVR extension pattern | [references/06-lbs-ivr.md](references/06-lbs-ivr.md) |
| Inbound webhooks | [references/07-callbacks.md](references/07-callbacks.md) |
| Status codes and error handling | [references/08-status-codes.md](references/08-status-codes.md) |
| Secrets, TLS, PII, consent | [references/09-security-best-practices.md](references/09-security-best-practices.md) |
| Go-live checklist | [references/10-production-checklist.md](references/10-production-checklist.md) |

Working reference implementations in [templates/typescript/](templates/typescript/). Port them
to the project's stack rather than inventing a different structure.

---

## Service map

Base URL from `IDEAMART_BASE_URL` (production `https://api.ideamart.io`). LBS is on
`https://api.dialog.lk/lbs/locate`.

| Need | Endpoint |
|---|---|
| Send SMS (MT) | `POST /sms/send` |
| Broadcast to base | `POST /sms/send` with `destinationAddresses: ["tel:all"]` |
| Receive SMS (MO) | *your callback URL* |
| Delivery report | *your callback URL* |
| USSD screen out | `POST /ussd/send` |
| USSD input in | *your callback URL* |
| Register (opt-in) | `POST /subscription/send` with `action: "1"` |
| **Unregister (opt-out)** | `POST /subscription/send` with `action: "0"` |
| Subscription status | `POST /subscription/getStatus` |
| **Subscriber base size** | `POST /subscription/query-base` |
| Subscription notification | *your callback URL* |
| OTP request / verify | `POST /subscription/otp/request`, `/subscription/otp/verify` |
| Charge a mobile account | `POST /caas/direct/debit` |
| Query balance (SL only) | `POST /caas/balance/query` |
| Charging notification | *your callback URL* |
| Locate a subscriber | `POST https://api.dialog.lk/lbs/locate` |
| IVR / voice | Not publicly documented — do not invent endpoints |

---

## The universal request/response shape

```
POST {baseUrl}/{path}
Content-Type: application/json

{ "applicationId": "APP_001807", "password": "…", "version": "1.0", …fields… }
```

```json
{ "statusCode": "S1000", "statusDetail": "Success", "version": "1.0" }
```

So: **one `post()` helper that injects credentials, plus thin typed wrappers per service.**
Do not write bespoke fetch calls per endpoint.

**Addressing** — always `tel:`-prefixed, no `+`, no spaces:

```
tel:94771234567          plain MSISDN
tel:hu3b84346f…          hash key (masking enabled) — opaque
tel:all                  broadcast (SMS only — guard this)
```

Normalise in one helper. Never concatenate `tel:` inline.

---

## Mistakes to avoid

- ❌ Checking `res.ok` / HTTP 200 as success — **Ideamart returns 200 for errors.** Branch on
  `statusCode`.
- ❌ `destinationAddresses: "tel:94…"` — it is always an **array**.
- ❌ Treating `E1351` (already registered) as a failure on Register — it is success.
- ❌ Treating `E1356` (not registered) as a failure on Unregister — it is success.
- ❌ Treating `E1379` (already completed) as a failure on debit — it is success.
- ❌ Retrying a debit with a new `externalTrxId` after a timeout — double charge.
- ❌ Generating your own USSD `sessionId` — echo the platform's.
- ❌ Ending a USSD flow with `mt-cont` — terminal screens use `mt-fin`.
- ❌ An in-memory USSD session `Map` in production — breaks across instances.
- ❌ Doing work before acknowledging a callback — sessions time out in seconds.
- ❌ `rejectUnauthorized: false` in shipped code — supply the intermediate CA instead.
- ❌ `NEXT_PUBLIC_` / `VITE_` / `REACT_APP_` on any Ideamart variable — that ships the
  password to the browser.
- ❌ Logging `password`, the OTP, `referenceNo`, or an unmasked `subscriberId`.
- ❌ Inventing IVR endpoints — there is no public specification.

---

## When you generate code, always

- Put credentials in `.env` (git-ignored) with a placeholder-only `.env.example`.
- Validate config at startup and fail loudly on missing variables.
- Set an explicit timeout on every call.
- Branch on `statusCode` and map codes to behaviour classes (configuration / client /
  user-state / transient).
- Retry only transient codes and transport errors, with backoff — never a debit with a new ID.
- Make callback handlers acknowledge first, validate the schema, verify `applicationId`, and
  deduplicate.
- Log `requestId` / `sessionId` / `externalTrxId` / `statusCode`; mask subscriber addresses.
- Mirror subscription state locally from notifications instead of polling `getStatus`.
- Use a decimal type for money.
- Match the host project's existing stack, structure and conventions.
