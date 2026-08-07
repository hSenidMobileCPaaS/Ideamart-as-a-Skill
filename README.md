# Ideamart Skill for AI Agents

An agent skill that lets any AI coding assistant build correct
[Ideamart](https://ideamart.io) integrations — SMS, USSD, Subscription, OTP, CaaS charging
and LBS — on the Axiata telco platform (Dialog, Airtel, Hutch in Sri Lanka; Smart in
Cambodia).

Point your assistant at this repository and it stops guessing parameter names, stops treating
HTTP 200 as success, stops hardcoding your application password, and starts producing
integrations that survive Limited Production.

---

## Install

### Claude Code

```bash
# Project-scoped
git clone https://github.com/<your-org>/IdeamartSkillForAgents .claude/skills/ideamart

# Or user-scoped, available in every project
git clone https://github.com/<your-org>/IdeamartSkillForAgents ~/.claude/skills/ideamart
```

The skill activates automatically when you mention Ideamart, or explicitly with
`/ideamart`.

### Cursor

```bash
git clone https://github.com/<your-org>/IdeamartSkillForAgents .ideamart
cp .ideamart/.cursor/rules/ideamart.mdc .cursor/rules/
```

Or add the repository URL under **Settings → Indexing & Docs**.

### GitHub Copilot

```bash
git clone https://github.com/<your-org>/IdeamartSkillForAgents .ideamart
cp .ideamart/.github/copilot-instructions.md .github/
```

### Windsurf, Codex, Cline, Aider, Zed, and anything else reading `AGENTS.md`

```bash
git clone https://github.com/<your-org>/IdeamartSkillForAgents .ideamart
```

Then reference `.ideamart/AGENTS.md` from your project's own `AGENTS.md`, or copy it in.

### Any assistant, no install

Paste the raw URL and ask it to read the file:

```
https://raw.githubusercontent.com/<your-org>/IdeamartSkillForAgents/main/AGENTS.md
```

---

## What's inside

```
SKILL.md                     Claude Code / Agent SDK entry point (with skill frontmatter)
AGENTS.md                    Portable entry point — Cursor, Windsurf, Codex, Cline, Aider…
.cursor/rules/ideamart.mdc   Cursor rule
.github/copilot-instructions.md
references/
  01-getting-started.md      Account, provisioning, credentials, environments, first call
  02-sms.md                  Send / receive / delivery reports, full parameter tables
  03-ussd.md                 Session model, ussdOperation state machine, menu design
  04-subscription.md         Register, unregister, status, base size, notifications, OTP
  05-caas.md                 Direct debit, balance query, idempotency, reconciliation
  06-lbs-ivr.md              LBS full spec; IVR status and extension pattern
  07-callbacks.md            All five inbound webhooks — contract, security, idempotency
  08-status-codes.md         Complete official code list + handling classes
  09-security-best-practices.md  Secrets, TLS, PII, consent, robustness
  10-production-checklist.md Pre-go-live verification
templates/
  .env.example               Every variable, documented, placeholders only
  typescript/
    ideamart-config.ts       The only module that reads process.env
    ideamart-types.ts        Request/response types for every service
    ideamart-client.ts       Client: credentials, timeouts, retries, typed errors
    callbacks-nextjs.ts      All five callback handlers
    ussd-session.ts          Session store + menu tree + ASCII sanitiser
scripts/
  smoke-test.sh / .ps1       Verify credentials, whitelisting, every endpoint
  test-callbacks.sh          Test your handlers with real payloads, no account needed
```

---

## Coverage

| Service | Operations |
|---|---|
| **SMS** | Send (MT), broadcast to base, receive (MO), delivery status reports |
| **USSD** | Send screens (`mt-init` / `mt-cont` / `mt-fin`), receive input (`mo-init` / `mo-cont`), session handling |
| **Subscription** | Register (opt-in), **unregister (opt-out)**, status, **query base size**, subscription notifications |
| **OTP** | Request, verify, masked-MSISDN handoff |
| **CaaS** | Direct debit, query balance, charging notifications, reconciliation |
| **LBS** | Get location, QoS precedence rules, privacy handling |
| **IVR** | Not publicly documented — documented as such, with an extension pattern |

Plus the complete official status-code list, the five callback contracts, and the operational
practices (secrets, TLS, consent, idempotency, retention) that keep an application approved.

---

## What it actually changes

Assistants writing Ideamart code without this reliably get the same things wrong. The skill
targets each one:

| Common mistake | Consequence |
|---|---|
| `if (res.ok) return "sent"` | Ideamart returns **HTTP 200 for errors**. Failures reported as successes. |
| `destinationAddresses: "tel:94…"` | It is always an **array**. Sends fail. |
| Hardcoded `applicationId` / `password` | A credential that can charge your subscribers, committed to git. |
| `E1351` / `E1356` / `E1379` treated as failures | Working flows reported as broken; charges repeated. |
| Debit retried with a fresh `externalTrxId` | **Double-charges a real person.** |
| Self-generated USSD `sessionId` | Sessions orphan; the user sees nothing. |
| USSD sessions in an in-process `Map` | Works in dev, breaks the moment you scale. |
| Work before acknowledging a callback | Sessions time out; duplicates pile up. |
| `rejectUnauthorized: false` shipped | Your credentials become interceptable. |

---

## Quick start

```bash
# 1. Configure
cp templates/.env.example .env
$EDITOR .env                       # add IDEAMART_APP_ID and IDEAMART_PASSWORD

# 2. Confirm your egress IP is whitelisted — run this ON THE SERVER
curl -4 https://myip.ideamart.io   # add the result to Allowed Host Addresses in the portal

# 3. Verify connectivity and credentials
./scripts/smoke-test.sh            # Windows: .\scripts\smoke-test.ps1

# 4. Test your callback handlers (no Ideamart account needed)
./scripts/test-callbacks.sh http://localhost:3000
```

Then ask your assistant something like:

> Add Ideamart subscription and SMS to this app — users opt in by SMS keyword, get a welcome
> message, and can text STOP to unsubscribe.

---

## Sources

Everything is derived from the official documentation at
[docs.ideamart.io](https://docs.ideamart.io) — SMS, USSD, Subscription, OTP, Charging, LBS and
Response Codes — plus the IdeaPro provisioning guides, and verified against a working
integration.

Where the official documentation is internally inconsistent (the delivery-report timestamp
format, the LBS sample's latitude/longitude ordering, `action` as string vs number), the skill
says so and tells the agent to handle both rather than picking one silently.

Ideamart evolves. Re-check [docs.ideamart.io](https://docs.ideamart.io) for anything
security- or money-critical, and contact support to confirm what your application is
provisioned for.

## Support

- **Sri Lanka** — `info@ideamart.io`, hotline 0773054056
- **Cambodia / Smart** — `info@ideamart.com.kh`, hotline & WhatsApp 85510212122

Quote your `requestId` / `externalTrxId` / `sessionId` and the `statusCode` when you contact
them — that is what they trace with.

## Contributing

Corrections welcome, especially: new endpoints, changed parameters, IVR specifications when
published, and Cambodia/Smart differences. Cite the documentation page or the observed
response for anything factual.

---

*Not an official Ideamart product. Verify anything security- or billing-critical against the
official documentation before going live.*
