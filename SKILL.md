---
name: ideamart
description: Build and integrate Ideamart (Dialog Axiata's Sri Lankan telco platform) services into any application — SMS, USSD, Subscription (register, unregister, status, query base size), OTP, CaaS charging (direct debit, balance query), and LBS. Use this whenever the user mentions Ideamart, IdeaPro, api.ideamart.io, MSISDN/`tel:` addressing, shortcode/keyword, USSD menus, subscriber base size, direct carrier billing, mobile-account charging, or telco SMS/USSD in Sri Lanka. Covers request/response contracts, callback (webhook) handlers, status codes, credential handling, and go-live requirements.
---

# Ideamart Integration Skill

Ideamart is Dialog Axiata's telco service platform for **Sri Lanka**, covering the operators
Dialog, Hutch (072 and 078) and Airtel. It exposes carrier capabilities — SMS, USSD,
subscription lifecycle, mobile-account charging, location — as JSON-over-HTTPS APIs that any
application can call.

This skill makes you able to build a correct, production-shaped Ideamart integration from
scratch, or add Ideamart to an existing product, **in any language**. The platform is JSON over
HTTPS with a shared-secret credential pair; nothing about it privileges a particular runtime or
framework. Build in whatever the host project already uses — the shipped templates cover
TypeScript/Node, Python, Java, Go, PHP and C#, and
[references/11-any-stack.md](references/11-any-stack.md) specifies the same integration in
language-neutral terms for everything else.

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

## Query the contract, do not recall it

The complete Ideamart contract ships as structured data
([`catalog/ideamart-api.json`](catalog/ideamart-api.json)) with a zero-dependency CLI over it.
Run it instead of reconstructing parameter names from memory — it is offline, read-only, needs
no install, and never sees credentials.

```bash
node tools/ideamart.mjs list [category]              # every service and callback
node tools/ideamart.mjs show <id>                    # full contract: params, response, rules
node tools/ideamart.mjs search "<query>"             # find by intent, e.g. "base size"
node tools/ideamart.mjs curl <id> [key=value ...]    # build a valid, runnable request
node tools/ideamart.mjs validate <id> '<json>'       # check a payload against the spec
node tools/ideamart.mjs code <statusCode>            # decode a status code + the fix
node tools/ideamart.mjs diagnose "<symptom>"         # cause and fix from a symptom
node tools/ideamart.mjs practices [severity]         # security and reliability rules
node tools/ideamart.mjs checklist                    # go-live checklist
node tools/ideamart.mjs reference <doc>              # print a reference document
node tools/ideamart.mjs platform                     # base URLs, operators, conventions
```

`--json` on any command for machine-readable output. If you cannot run commands — or Node is
not available — read `catalog/ideamart-api.json` directly; it is plain JSON and holds the same
data. The CLI is a documentation reader, not part of the integration: it makes no network
calls, never sees a credential, and puts no constraint on the stack you build in.

**Working order:** `search`/`list` to find the service → `show` for the exact contract → write
the code → `validate` the payload you generated → `code`/`diagnose` when something fails.

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

**Step 3 — Pick the stack, then scaffold config before code.** The stack is the host project's,
not the template's: a Django codebase gets Python, a Spring service gets Java, a Laravel app
gets PHP. Create `.env` / `.env.example` and the config module first, so no credential ever has
a chance to land in a source file. Copy from [templates/.env.example](templates/.env.example)
— the variable names are identical in every language — and the config file from the matching
directory in [templates/](templates/README.md).

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

Production host for everything except LBS: `https://api.ideamart.io` (alias
`https://api.dialog.lk`).

**Configure one environment variable per provisioned service** — `IDEAMART_SMS_SEND_URL`,
`IDEAMART_USSD_SEND_URL`, and so on — never one shared base URL. An application can only call
the APIs it was provisioned for, so an unset endpoint means that service is not enabled and
the client should refuse to call it rather than fail with `E1309` at the platform. Never
inline a URL. See [templates/.env.example](templates/.env.example).

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

So the correct client, in every language, is one `post(path, payload)` helper that injects
credentials from config, plus per-service wrappers. Do not write bespoke HTTP calls per
endpoint. [templates/](templates/README.md) has complete working implementations of exactly
this in six languages — take the closest one rather than inventing a new structure, and read
[references/11-any-stack.md](references/11-any-stack.md) if the project's stack is not among
them.

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
  clients fail — Node, Python, Java, Go and .NET all reject it where a browser papers over it.
  Disabling verification (`rejectUnauthorized: false`, `verify=False`, `InsecureSkipVerify`,
  `CURLOPT_SSL_VERIFYPEER => false`, a trust-all `TrustManager`) is **not** an acceptable
  production fix in any of them — it opens you to interception of your own credentials. Supply
  the intermediate CA explicitly instead. See
  [references/09-security-best-practices.md](references/09-security-best-practices.md#3-tls-verification).

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
| [11-any-stack.md](references/11-any-stack.md) | The integration specified language-neutrally: the seven components, per-language notes, port acceptance checklist |

Templates in [templates/](templates/README.md) are working reference implementations of the
same integration — config, client, callback handlers and session store — in **TypeScript/Node,
Python, Java, Go, PHP and C#**, plus a shared `.env.example`. Scripts in [scripts/](scripts/)
are curl smoke tests, so they exercise a handler written in any language.

---

## When generating code

- **Write it in the host project's language and idiom.** Never introduce a new runtime, a
  Node sidecar, or a second service just to reach Ideamart — a plain HTTPS POST is all it takes,
  and every stack can make one.
- Put every Ideamart call behind a service module. No endpoint URLs or credentials scattered
  through controllers.
- Type or schema-validate both directions with whatever the stack uses (types, pydantic, Bean
  Validation, struct tags, data annotations). Inbound callback bodies come from outside your
  trust boundary.
- Log `requestId` / `externalTrxId` / `sessionId` on every operation — they are how Ideamart
  support traces an issue. Log the `statusCode`. **Never** log `password`, and mask
  `subscriberId` in logs.
- Persist subscription state locally; do not call `getStatus` on every request.
- Make outbound calls retry-safe: retry only on transport errors and `E1603`/`E1601`, never
  on a definitive `E13xx`, and never retry a debit with a new `externalTrxId`.
- Match the host project's stack and conventions. These templates are a specification, not
  a framework to impose.
