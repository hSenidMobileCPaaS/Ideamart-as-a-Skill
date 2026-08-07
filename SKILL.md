---
name: ideamart
description: Build and integrate Ideamart (Dialog / Smart Axiata telco platform) services into any application — SMS, USSD, Subscription (register, unregister, status, query base size), OTP, CaaS charging (direct debit, balance query), and LBS. Use this whenever the user mentions Ideamart, IdeaPro, api.ideamart.io, MSISDN/`tel:` addressing, shortcode/keyword, USSD menus, subscriber base size, direct carrier billing, mobile-account charging, or telco SMS/USSD in Sri Lanka or Cambodia. Covers request/response contracts, callback (webhook) handlers, status codes, credential handling, and go-live requirements.
---

# Ideamart Integration Skill

Ideamart is Axiata's telco service platform (Dialog, Airtel, Hutch in Sri Lanka; Smart in
Cambodia). It exposes carrier capabilities — SMS, USSD, subscription lifecycle, mobile-account
charging, location — as JSON-over-HTTPS APIs that any application can call.

This skill makes you able to build a correct, production-shaped Ideamart integration from
scratch, or add Ideamart to an existing product.

---

## The five rules you must never break

These are the mistakes that cost service providers their app approval, their subscribers,
or real money. Apply them without being asked.

1. **Never hardcode `applicationId` or `password`.** They go in environment variables, read
   through one config module that validates at startup. Never in source, never in a client
   bundle, never in a committed file, never in a log line, never in a git history. See
   [references/09-security-best-practices.md](references/09-security-best-practices.md).

2. **Never call Ideamart from client-side code.** Browser JS, mobile apps, and Flutter/React
   Native code must call *your* backend, which calls Ideamart. The credentials are
   symmetric-secret; anything that ships to a device leaks them. The platform also enforces
   IP whitelisting, which a mobile client cannot satisfy.

3. **Never charge or subscribe a user without explicit consent, and never without telling
   them the amount and frequency first.** Ideamart suspends applications for this. Consent
   must be captured and stored with a timestamp.

4. **Never assume the MSISDN is real.** Applications provisioned with number masking receive
   a hash (`tel:hu3b84346f...`) instead of `tel:94771234567`. Treat `subscriberId` as an
   opaque string, store it as given, and send back exactly what you received.

5. **Always make charging idempotent.** Generate a unique `externalTrxId` per charge attempt,
   persist it *before* the call, and never retry with a fresh one — a retry with a new ID
   double-charges a real person.

---

## How to approach an Ideamart task

**Step 1 — Establish what already exists.** Ask (or check the code for) which of these the
user has:

- An Ideamart account and a provisioned app (`APP_00XXXX` + password)?
- Which operators and which APIs were provisioned? An app can only call services it was
  provisioned for — otherwise you get `E1309`.
- A publicly reachable HTTPS URL for callbacks? Required for MO SMS, USSD, subscription
  notifications, and charging notifications. Without one, inbound flows cannot work at all.
- A static egress IP? Required — see rule below.

If they have none of this, they are pre-provisioning. Read
[references/01-getting-started.md](references/01-getting-started.md) and walk them through
it; you can still build and test the whole integration against the local mock first.

**Step 2 — Pick the services.** Map the product requirement to APIs using the table below.
Most real applications need *Subscription + SMS* at minimum; charging apps add *CaaS*;
feature-phone reach adds *USSD*.

**Step 3 — Scaffold config before code.** Create `.env` / `.env.example` and the config
module first, so no credential ever has a chance to land in a source file. Copy from
[templates/.env.example](templates/.env.example) and
[templates/typescript/ideamart-config.ts](templates/typescript/ideamart-config.ts).

**Step 4 — Build the client, then the callbacks.** Outbound calls (`send`, `debit`) and
inbound callbacks (MO SMS, USSD, notifications) are two separate halves. Both are required
for most services. See [references/07-callbacks.md](references/07-callbacks.md) — the
callback contract has hard rules (respond `S1000` fast, be idempotent, never trust the body).

**Step 5 — Handle status codes properly.** Ideamart returns HTTP 200 with an application-level
`statusCode` in the body. `S1000` is success; everything else is a failure you must branch on.
Checking only the HTTP status is a bug. See
[references/08-status-codes.md](references/08-status-codes.md).

**Step 6 — Run the go-live checklist** in
[references/10-production-checklist.md](references/10-production-checklist.md) before the
user requests production approval.

---

## Service map

| Need | Service | Endpoint | Reference |
|---|---|---|---|
| Send an SMS to a subscriber (MT) | SMS Send | `POST /sms/send` | [02-sms](references/02-sms.md) |
| Broadcast to the whole subscriber base | SMS Send with `tel:all` | `POST /sms/send` | [02-sms](references/02-sms.md) |
| Receive an SMS from a user (MO) | SMS Receive | *your callback URL* | [02-sms](references/02-sms.md) |
| Know whether an SMS was delivered | Delivery Status Report | *your callback URL* | [02-sms](references/02-sms.md) |
| Interactive menu on any phone | USSD Send | `POST /ussd/send` | [03-ussd](references/03-ussd.md) |
| React to a user dialling your code | USSD Receive | *your callback URL* | [03-ussd](references/03-ussd.md) |
| Opt a user in | Subscription Register | `POST /subscription/send` (`action:"1"`) | [04-subscription](references/04-subscription.md) |
| Opt a user out (**unsub**) | Subscription Unregister | `POST /subscription/send` (`action:"0"`) | [04-subscription](references/04-subscription.md) |
| Check if a user is subscribed | Subscription Status | `POST /subscription/getStatus` | [04-subscription](references/04-subscription.md) |
| **Subscriber base size** | Query Base | `POST /subscription/query-base` | [04-subscription](references/04-subscription.md) |
| Be told when a user subs/unsubs | Subscription Notification | *your callback URL* | [04-subscription](references/04-subscription.md), [07-callbacks](references/07-callbacks.md) |
| Register a user from a web/app form | OTP Request → Verify | `POST /subscription/otp/request`, `/verify` | [04-subscription](references/04-subscription.md) |
| Charge a user's mobile account | CaaS Direct Debit | `POST /caas/direct/debit` | [05-caas](references/05-caas.md) |
| Check a user can afford a charge | CaaS Query Balance | `POST /caas/balance/query` | [05-caas](references/05-caas.md) |
| Be told the outcome of a charge | Charging Notification | *your callback URL* | [05-caas](references/05-caas.md), [07-callbacks](references/07-callbacks.md) |
| Locate a subscriber | LBS Get Location | `POST https://api.dialog.lk/lbs/locate` | [06-lbs-ivr](references/06-lbs-ivr.md) |
| Voice / IVR | Not in public docs — see extension pattern | — | [06-lbs-ivr](references/06-lbs-ivr.md) |

Base URL for everything except LBS: `https://api.ideamart.io`
(alias `https://api.dialog.lk`; Cambodia/Smart service providers use their regional host).
Always read it from `IDEAMART_BASE_URL` — never inline it.

---

## The shape of every Ideamart call

Every outbound API is the same shape. Learn it once:

```
POST https://api.ideamart.io/<service-path>
Content-Type: application/json

{ "applicationId": "APP_001807", "password": "…", "version": "1.0", …service fields… }
```

Every response is HTTP 200 with:

```json
{ "statusCode": "S1000", "statusDetail": "Success", "version": "1.0", … }
```

So the correct client is one `post(path, payload)` helper that injects credentials from
config, plus per-service typed wrappers. Do not write bespoke fetch calls per endpoint.
[templates/typescript/ideamart-client.ts](templates/typescript/ideamart-client.ts) is a
complete working implementation of exactly this — port it to the project's language rather
than inventing a new structure.

### Addressing

Subscriber addresses are **always** prefixed `tel:` with no `+` and no spaces:

```
tel:94771234567          plain MSISDN (unmasked app)
tel:hu3b84346f63899a…    hash key (masked app) — opaque, use as-is
tel:all                  broadcast to the subscribed base (SMS send only)
```

Normalise once, in one function, at the boundary. Never string-concatenate `tel:` inline.

---

## Non-obvious things that will bite you

- **IP whitelisting is mandatory.** The platform rejects calls from any IP not in the app's
  *Allowed Host Addresses* list with `E1303`. Get the egress IP with
  `curl -4 https://myip.ideamart.io` **from the server that will make the calls** — not from
  a laptop. Serverless/autoscaling platforms with rotating egress IPs need a static NAT or a
  fixed-IP proxy; decide this before choosing a host.
- **Limited Production is the first approval state.** Only the numbers listed under
  *Whitelisted Numbers* can use the app. If a test number "does nothing", check that list
  before debugging code.
- **HTTP 200 ≠ success.** Branch on `statusCode`, always.
- **`E1309` means not provisioned, not a code bug.** Calling a service the app was not
  provisioned for fails no matter how correct the payload is.
- **Callback URLs are configured in the portal, not in code.** Changing your route path means
  updating the provisioning record too.
- **Do not spoof `X-Forwarded-For`.** Reference/demo code sometimes sets it to fake a
  whitelisted origin through a proxy. That is a local-development crutch. In production the
  platform sees your real egress IP, and sending forged headers to a carrier is exactly the
  kind of thing that gets an app suspended.
- **TLS:** some Ideamart hosts serve an incomplete certificate chain, which makes strict
  clients (notably Node.js) fail. Disabling verification globally
  (`rejectUnauthorized: false`, `verify=False`) is **not** an acceptable production fix — it
  opens you to interception of your own credentials. Supply the intermediate CA explicitly
  instead. See [references/09-security-best-practices.md](references/09-security-best-practices.md#tls-verification).

---

## Reference files

Read the one that matches the task. Do not guess parameter names — they are all here.

| File | Contents |
|---|---|
| [01-getting-started.md](references/01-getting-started.md) | Account, provisioning, credentials, environments, first call |
| [02-sms.md](references/02-sms.md) | Send / receive / delivery report, full parameter tables |
| [03-ussd.md](references/03-ussd.md) | Session model, `ussdOperation` state machine, menu building |
| [04-subscription.md](references/04-subscription.md) | Register, **unregister**, status, **query base size**, notifications, OTP |
| [05-caas.md](references/05-caas.md) | Direct debit, balance query, idempotency, notifications |
| [06-lbs-ivr.md](references/06-lbs-ivr.md) | LBS full spec; IVR/voice extension pattern |
| [07-callbacks.md](references/07-callbacks.md) | All inbound webhooks, contract, security, idempotency |
| [08-status-codes.md](references/08-status-codes.md) | Complete official code list + how to handle each class |
| [09-security-best-practices.md](references/09-security-best-practices.md) | Secrets, TLS, PII, logging, consent, rate limits |
| [10-production-checklist.md](references/10-production-checklist.md) | Pre-go-live verification |

Templates in [templates/](templates/) are working TypeScript/Node reference implementations
(config, client, types, Next.js callback routes, USSD session store) plus a `.env.example`.
Scripts in [scripts/](scripts/) are curl smoke tests for every endpoint.

---

## When generating code

- Put every Ideamart call behind a service module. No endpoint URLs or credentials scattered
  through controllers.
- Type or schema-validate both directions. Inbound callback bodies come from outside your
  trust boundary.
- Log `requestId` / `externalTrxId` / `sessionId` on every operation — they are how Ideamart
  support traces an issue. Log the `statusCode`. **Never** log `password`, and mask
  `subscriberId` in logs.
- Persist subscription state locally; do not call `getStatus` on every request.
- Make outbound calls retry-safe: retry only on transport errors and `E1603`/`E1601`, never
  on a definitive `E13xx`, and never retry a debit with a new `externalTrxId`.
- Match the host project's stack and conventions. These templates are a specification, not
  a framework to impose.
