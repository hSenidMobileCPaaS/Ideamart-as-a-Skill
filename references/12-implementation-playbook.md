# Implementation Playbook — A to Z

Everything from "we have an idea" to "real subscribers are being charged", for **any**
language and **any** starting point. Work top to bottom on a new project; jump to
[§2](#2-entry-point-b--mid-build) or [§3](#3-entry-point-c--retrofit-into-a-live-application)
if code already exists.

The generator does the typing. Every step below that says *generate* means:

```bash
node tools/ideamart.mjs codegen <what> --lang=<language> [--out=<dir>]
```

---

## 0. Establish the ground truth (all entry points)

Ask these five questions before writing anything. Each answer changes the plan, and guessing
wastes days.

| Question | If yes | If no |
|---|---|---|
| Provisioned app? (`APP_00XXXX` + password) | Note which APIs were enabled | Start at [01-getting-started](01-getting-started.md); you can still build everything against a local mock |
| Which APIs are enabled? | Configure exactly those URLs | An unprovisioned call fails `E1309` no matter how perfect the payload |
| Static egress IP? | Whitelist it in the portal | Decide the hosting story now — NAT gateway, static-IP proxy or a fixed host. Retrofitting this is painful |
| Public HTTPS URL for callbacks? | Register the five paths | MO SMS, USSD and every notification cannot work at all until there is one |
| Limited Production or full? | Only whitelisted numbers work | Full production means real subscribers and real money on every call |

Run `node tools/ideamart.mjs platform` for base URLs and operators, and
`node tools/ideamart.mjs list` for what exists.

---

## 1. Entry point A — greenfield

You are building the application around Ideamart.

**1. Choose the stack.** Whatever you would use anyway — Ideamart is JSON over HTTPS. See
[11-any-stack](11-any-stack.md).

**2. Config first, so no credential can ever land in source.**

```bash
cp templates/.env.example .env          # then fill in APP_ID + password
node tools/ideamart.mjs codegen config --lang=<language>
```

**3. Generate the client and the error module.**

```bash
node tools/ideamart.mjs codegen client --lang=<language>
node tools/ideamart.mjs codegen errors --lang=<language>
node tools/ideamart.mjs codegen types  --lang=<language>   # where the language has types
```

You now have every service wrapper, the credential injection, the timeout, the `tel:`
normaliser, the benign-code handling and all 86 status codes with their handling classes.

**4. Prove the credentials before building features.** Query Base needs no subscriber and
charges nothing:

```bash
./scripts/smoke-test.sh    # or: node tools/ideamart.mjs curl subscription-query-base
```

`S1000` means credentials, whitelisting and connectivity are all correct. `E1313` is
credentials, `E1303` is the egress IP, `E1309` is provisioning. Fix before continuing.

**5. Build the flow you actually need** — [§4](#4-flow-recipes).

**6. Callbacks** — [§5](#5-callbacks-half-the-integration).

**7. Error handling** — [§6](#6-error-handling-that-survives-production).

**8. Go live** — [§8](#8-go-live).

---

## 2. Entry point B — mid-build

An application exists; Ideamart is a feature you are adding now.

1. **Find the seam.** Ideamart is an outbound integration plus five inbound routes. It belongs
   beside your other third-party clients — `services/`, `integrations/`, `infrastructure/`,
   whatever this codebase already calls that layer. Do not scatter calls through controllers.
2. **Audit what exists first** if any Ideamart code is already there:
   `node tools/ideamart.mjs practices` and the `ideamart-review` skill. Half-built integrations
   usually have a hardcoded credential and an `if (res.ok)`.
3. **Generate into your own module** rather than pasting endpoint URLs into existing services:
   `codegen client --lang=<language> --out=<your integration dir>`.
4. **Reuse what the project already has** — its HTTP client, its logger, its queue, its
   secret manager. Replace the generated `post()` internals with the project's client if it has
   one; keep the `statusCode` branching exactly as generated.
5. Continue at [§4](#4-flow-recipes).

---

## 3. Entry point C — retrofit into a live application

Users already depend on this application. The integration must land without disturbing them.

1. **Ship it dark.** Put every Ideamart path behind a flag that defaults to off. Telco calls
   cost money and messages reach real phones; a half-finished flow that goes live by accident
   is a support incident.
2. **Callbacks are additive** — five new routes that return `S1000`. They can be deployed and
   registered before any user-facing feature exists, and they will simply log until you use
   them. Deploy them first: registering the URLs in the portal often needs a re-approval cycle,
   so start that clock early.
3. **The egress IP is the usual blocker.** A running production app may sit behind autoscaling
   or serverless egress. Check it on the real server (`curl -4 https://myip.ideamart.io`) before
   promising a date.
4. **Do not retrofit charging first.** Land SMS or subscription, watch it for a week, then add
   CaaS. Charging failure modes are the expensive ones.
5. **Map existing users to subscribers deliberately.** An existing account is not consent. You
   need a fresh opt-in, recorded, before Register or any charge — see
   [09-security-best-practices](09-security-best-practices.md#5-consent).
6. **Keep the blast radius visible:** log `statusCode` from day one and alert on the
   configuration class (`E1303`, `E1313`, `E1309`) before you enable anything for users.

---

## 4. Flow recipes

The four flows that cover almost every Ideamart application. Each is a sequence of generated
calls plus the state you must keep.

### A. Keyword opt-in over SMS

```
user texts JOIN to your shortcode
  → MO SMS callback fires             (sms-mo)
  → you record consent + timestamp
  → register(subscriberId)            (subscription-register, E1351 = already in = success)
  → sendSms(subscriberId, welcome)    (sms-send)
user texts STOP
  → MO SMS callback fires
  → unregister(subscriberId)          (subscription-unregister, E1356 = already out = success)
  → stop every queued message for that subscriber
```

State to keep: subscription mirror keyed by `subscriberId`, consent record, dedupe on
`requestId`.

### B. Web or app sign-up without SMS

```
user types their number
  → requestOtp(subscriberId, metaData)   (otp-request) → referenceNo (server-side only)
user types the PIN
  → verifyOtp(referenceNo, otp)          (otp-verify)  → masked subscriberId
  → store the MASKED id; it is the identifier for every later call
```

Rate-limit per number **and** per IP before `requestOtp`, or the app is an SMS-bombing tool.
OTPs last 60 minutes, three attempts.

### C. USSD menu

```
user dials *xxx#
  → USSD receive callback, ussdOperation "mo-init"   (ussd-receive)
  → acknowledge S1000 immediately
  → create session keyed by the platform's sessionId
  → sendUssd(sessionId, address, screen, "mt-cont")  (ussd-send)
user presses a key
  → USSD receive callback, "mo-cont" → look up session → next screen
last screen
  → sendUssd(..., "mt-fin") and delete the session
```

The session store must be shared across instances and expire in ~2 minutes. Screens are plain
ASCII, ~160 characters. Never generate your own `sessionId`.

### D. Charging

```
before the call
  → externalTrxId = generate();  PERSIST IT with status PENDING
  → debit(subscriberId, amount, externalTrxId)        (caas-direct-debit)
S1000            → mark CHARGED
E1379            → already completed: mark CHARGED, do NOT charge again
E1378            → insufficient balance: tell the user, retry later
timeout / no answer
  → mark UNKNOWN. Re-call with the SAME externalTrxId, or wait for the
    charging notification callback to settle it. NEVER a new id.
```

Money is a decimal type end to end. `queryBalance` is advisory only — handle `E1378` on the
debit regardless of what it said.

---

## 5. Callbacks: half the integration

Five inbound routes, one contract. Generate them:

```bash
node tools/ideamart.mjs codegen callbacks --lang=<language>
```

| Callback | Fires when | Without it |
|---|---|---|
| MO SMS | user texts your shortcode | keyword opt-in and STOP silently do nothing |
| Delivery report | an MT SMS reaches a final state | you cannot prove delivery |
| USSD receive | user dials or presses a key | USSD does not work at all |
| Subscription notification | anyone subscribes or unsubscribes | your local state drifts from the platform's |
| Charging notification | a charge reaches a final state | timed-out charges never settle |

Rules that are not negotiable: acknowledge `S1000` **before** doing work, always HTTP 200,
deduplicate on the documented key, never trust the body. Full detail in
[07-callbacks](07-callbacks.md).

Register the paths in the portal once and keep them stable — changing a path later means
editing the provisioning record.

---

## 6. Error handling that survives production

```bash
node tools/ideamart.mjs codegen errors --lang=<language>
```

That module gives you every published code, its handling class, the benign codes per operation,
and `classify()` / `describe()` / `isBenign()`. Wire it in like this:

| Class | Your behaviour |
|---|---|
| `success` | Proceed. |
| `configuration` | **Page someone.** The integration is down, not one request. Never retry. |
| `client` | Fix the payload or prompt the user. Never retry unchanged. |
| `user-state` | Communicate. Retry only after the user acts. |
| `transient` | Exponential backoff with jitter, capped attempts, then dead-letter. |

Three benign codes must be treated as success or you will report working flows as broken:
`E1351` (register), `E1356` (unregister), `E1379` (debit).

Log `requestId` / `sessionId` / `externalTrxId` / `statusCode` on every operation — those are
what Ideamart support traces with. Never log the password, the OTP, `referenceNo`, or an
unmasked subscriber address.

---

## 7. Testing before — and after — provisioning

| What | How |
|---|---|
| Callback handlers | `./scripts/test-callbacks.sh http://localhost:3000` — valid, malformed, wrong-app, missing-field, oversized and duplicate payloads. Plain curl, so it works against any language |
| Outbound payloads | `node tools/ideamart.mjs validate <service> '<json>'` before you ever send one |
| Credentials + network | `./scripts/smoke-test.sh` from the server that will make the calls |
| Failure paths | Force `E1313` (wrong password), `E1303` (call from an unlisted IP), `E1378` (charge above balance) and a timeout. Handling code that has never run is not handling code |

**No account yet?** Everything above still works except the live calls. If you want the whole
integration exercised end to end before provisioning, ask the agent for a local mock server —
it can generate one that answers every endpoint from the catalog's sample responses and returns
chosen error codes on demand. It is built on request, not shipped by default, because a mock
that drifts from the contract is worse than no mock.

---

## 8. Go live

```bash
node tools/ideamart.mjs checklist          # every item, with evidence required
```

Run it against the real project and mark each item PASS / FAIL / CANNOT VERIFY with the
evidence — a file path, a config value, a test run. The full list is in
[10-production-checklist](10-production-checklist.md); the nine sections are credentials,
network, correctness, callbacks, charging, consent, privacy, operations and testing.

The last question is the only one that matters: **is this safe to put in front of real
subscribers who can be charged real money?**

---

## Quick command map

| You want to | Run |
|---|---|
| See what exists | `ideamart list` |
| Get one contract exactly | `ideamart show <service>` |
| Write the call | `ideamart codegen <service> --lang=<language>` |
| Write the whole client | `ideamart codegen client --lang=<language>` |
| Wire up error codes | `ideamart codegen errors --lang=<language>` |
| Write the webhooks | `ideamart codegen callbacks --lang=<language>` |
| Check a payload | `ideamart validate <service> '<json>'` |
| Decode a failure | `ideamart code <statusCode>` |
| Diagnose a symptom | `ideamart diagnose "<symptom>"` |
| Ship it | `ideamart checklist` |
