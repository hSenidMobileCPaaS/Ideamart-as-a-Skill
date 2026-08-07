<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" width="132" alt="Ideamart Skill for Agents">
  </picture>
</p>

<h1 align="center">Ideamart Skill for Agents</h1>

<p align="center">
  <em>Telco integrations your AI agent gets right the first time.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-0F766E?style=flat-square" alt="MIT license">
  <img src="https://img.shields.io/badge/endpoints-14-0F766E?style=flat-square" alt="14 endpoints">
  <img src="https://img.shields.io/badge/callbacks-5-0F766E?style=flat-square" alt="5 callbacks">
  <img src="https://img.shields.io/badge/status%20codes-80%2B-0F766E?style=flat-square" alt="80+ status codes">
  <img src="https://img.shields.io/badge/works%20with-20%2B%20agents-0F766E?style=flat-square" alt="Works with 20+ agents">
  <img src="https://img.shields.io/badge/dependencies-0-0F766E?style=flat-square" alt="Zero dependencies">
</p>

<p align="center">
  <strong>SMS · USSD · Subscription · OTP · CaaS charging · LBS</strong><br>
  <sub>Dialog Axiata's Sri Lankan telco platform — operators Dialog, Hutch (072/078) and Airtel.</sub>
</p>

---

Ask an AI agent to integrate Ideamart today and it will confidently write
`if (response.ok) return "sent"`. Ideamart returns **HTTP 200 for failures**, so that line
reports every error as a success. It will also hardcode your `applicationId`, send
`destinationAddresses` as a string, and — if you let it near the charging API — retry a timed
out debit with a fresh transaction ID and charge someone twice.

None of that is the model being careless. It is the model not having the contract.

This repo gives it the contract: every endpoint, every parameter, every status code, and the
handful of rules that separate a working integration from a suspended one.

---

## Install

Pick your agent. Everything below is the same content behind a different filename.

<details open>
<summary><strong>Claude Code</strong></summary>

```
/plugin marketplace add OWNER/IdeamartSkillForAgents
```
```
/plugin install ideamart@ideamart
```

Or clone it as a skill directly:

```bash
git clone https://github.com/OWNER/IdeamartSkillForAgents ~/.claude/skills/ideamart
```
</details>

<details>
<summary><strong>Cursor</strong></summary>

```bash
git clone https://github.com/OWNER/IdeamartSkillForAgents .ideamart
cp .ideamart/.cursor/rules/ideamart.mdc .cursor/rules/
```
</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex plugin marketplace add OWNER/IdeamartSkillForAgents
codex plugin add ideamart@ideamart
```
</details>

<details>
<summary><strong>GitHub Copilot</strong></summary>

CLI:

```bash
copilot plugin marketplace add OWNER/IdeamartSkillForAgents
```

Editor extension — copy the instructions file:

```bash
cp .ideamart/.github/copilot-instructions.md .github/
```
</details>

<details>
<summary><strong>Gemini CLI / Antigravity</strong></summary>

```bash
gemini extensions install https://github.com/OWNER/IdeamartSkillForAgents
```
</details>

<details>
<summary><strong>Windsurf · Cline · Kiro · Qoder</strong></summary>

```bash
git clone https://github.com/OWNER/IdeamartSkillForAgents .ideamart
cp .ideamart/.windsurf/rules/ideamart.md  .windsurf/rules/     # Windsurf
cp .ideamart/.clinerules/ideamart.md      .clinerules/         # Cline
cp .ideamart/.kiro/steering/ideamart.md   .kiro/steering/      # Kiro
cp .ideamart/.qoder/rules/ideamart.md     .qoder/rules/        # Qoder
```
</details>

<details>
<summary><strong>Aider · Zed · Amp · Jules · Junie · OpenCode · anything reading AGENTS.md</strong></summary>

```bash
git clone https://github.com/OWNER/IdeamartSkillForAgents .ideamart
```

Then reference `.ideamart/AGENTS.md` from your own `AGENTS.md`, or copy it to the project root.
</details>

<details>
<summary><strong>No install — any assistant</strong></summary>

Paste the raw URL and ask it to read the file:

```
https://raw.githubusercontent.com/OWNER/IdeamartSkillForAgents/main/AGENTS.md
```
</details>

Full matrix of what each agent reads: **[docs/agent-support.md](docs/agent-support.md)**.

---

## The part that makes it precise

Documentation alone still leaves an agent recalling parameter names from memory. So the whole
Ideamart contract also ships as **structured data** — [`catalog/ideamart-api.json`](catalog/ideamart-api.json) —
with a zero-dependency CLI over it that any agent can drive through its shell.

This is the capability an MCP server would give you, without running a server: no install, no
dependencies, no process to keep alive, and it works in every agent that can run a command.

```bash
$ node tools/ideamart.mjs show subscription-query-base

Query Base (subscriber base size)  (subscription-query-base)
Return the number of subscribers currently registered to the application.

  Endpoint  POST https://api.ideamart.io/subscription/query-base

  Request parameters
    applicationId   string   required
      Application ID as received when provisioned.
    password        string   required
      Password as received when provisioned.

  Response fields
    baseSize        Current subscriber base size. Arrives as a string — coerce before arithmetic.
    ...
```

| Command | Answers |
|---|---|
| `list [category]` | What services exist? |
| `show <id>` | What exactly does this call take and return? |
| `search "<query>"` | Which service does the thing I want? |
| `curl <id> [k=v]` | Give me a valid, runnable request. |
| `validate <id> '<json>'` | Is this payload correct? |
| `code <statusCode>` | What does this error mean, and what do I do? |
| `diagnose "<symptom>"` | Why is this not working? |
| `practices [severity]` | What must I not get wrong? |
| `checklist` | Am I ready for production? |
| `reference <doc>` | Show me the full guide. |
| `platform` | Base URLs, operators, conventions. |

Add `--json` to any command for machine-readable output. Agents that cannot run commands read
the catalog JSON directly — same data.

It catches the real mistakes, not just missing fields:

```bash
$ node tools/ideamart.mjs validate sms-send '{"message":"hi","destinationAddresses":"tel:94771234567"}'

  ✗ 3 error(s)  against sms-send
    ✗ Missing required field "applicationId" — Application ID as given when provisioned.
    ✗ Missing required field "password" — Password given when provisioned.
    ✗ "destinationAddresses" must be an ARRAY, got string. This is the most common Ideamart integration bug.
```

And it turns a symptom into a fix:

```bash
$ node tools/ideamart.mjs diagnose "works locally, fails in production"

  Likely cause
  The deployed server's egress IP is not whitelisted, or secrets are not set in the host environment.

  Fix
  Run curl -4 https://myip.ideamart.io ON THE DEPLOYED SERVER and add that IP to
  Allowed Host Addresses. Confirm IDEAMART_APP_ID and IDEAMART_PASSWORD are set in
  the host's secret manager.
```

---

## Configuration is two credentials and your enabled endpoints

An Ideamart application can only call the APIs it was provisioned for, so the configuration
mirrors that exactly — nothing else is environment-dependent:

```bash
IDEAMART_APP_ID=APP_XXXXXX
IDEAMART_PASSWORD=replace-me

# Uncomment only what is enabled on your application:
#IDEAMART_SMS_SEND_URL=https://api.ideamart.io/sms/send
#IDEAMART_SUBSCRIPTION_SEND_URL=https://api.ideamart.io/subscription/send
#IDEAMART_CAAS_DEBIT_URL=https://api.ideamart.io/caas/direct/debit
```

An unset endpoint is meaningful: the client refuses the call locally, so you get a clear error
naming the missing variable instead of `E1309` from the platform after a round trip. Pointing
one at a mock is the whole local-development switch.

Timeouts, encodings and retry policy are **not** configuration — they are constants in the
client, because they are properties of the protocol rather than of your deployment.

## Architecture it steers agents toward

<p align="center">
  <img src="assets/architecture.svg" width="860" alt="A browser or mobile client calls your backend; your backend holds the credentials and calls Ideamart over HTTPS from a static whitelisted IP; Ideamart reaches subscribers on Dialog, Hutch and Airtel and posts callbacks back to your backend. Credentials never cross the trust boundary to the client.">
</p>

---

## Coverage

| Service | Operations |
|---|---|
| **SMS** | Send (MT), broadcast to base, receive (MO), delivery status reports |
| **USSD** | Send screens, receive input, the `mo-init`/`mo-cont`/`mt-init`/`mt-cont`/`mt-fin` state machine |
| **Subscription** | Register (opt-in), **unregister (opt-out)**, status, **query base size**, notifications |
| **OTP** | Request, verify, masked-MSISDN handoff |
| **CaaS** | Direct debit, query balance, charging notifications, reconciliation |
| **LBS** | Get location, QoS precedence rules, privacy handling |
| **IVR** | Not publicly documented — documented as such, with an extension pattern |

Plus the complete official status-code table, all five callback contracts, and the operational
practices that keep an application approved.

### Skills

| Skill | Use it for |
|---|---|
| `ideamart` | General Ideamart work; the rules and the service map |
| `ideamart-scaffold` | Starting a new integration |
| `ideamart-callbacks` | Inbound webhooks |
| `ideamart-review` | Auditing existing code |
| `ideamart-debug` | A failing call or callback |
| `ideamart-golive` | The pre-production checklist |
| `ideamart-help` | Quick reference |

On plugin-tier hosts these are also slash commands: `/ideamart`, `/ideamart-review`, and so on.

---

## What it actually changes

Nine mistakes agents make on this platform, and what each one costs:

| Mistake | Consequence |
|---|---|
| `if (res.ok) return "sent"` | Ideamart returns **HTTP 200 for errors**. Every failure reported as a success. |
| `destinationAddresses: "tel:94…"` | It is always an **array**. Sends fail. |
| Hardcoded `applicationId` / `password` | A credential that can charge your subscribers, committed to git. |
| `E1351` / `E1356` / `E1379` treated as failures | Working flows reported as broken; charges repeated. |
| Debit retried with a fresh `externalTrxId` | **Double-charges a real person.** |
| Self-generated USSD `sessionId` | Sessions orphan; the user's screen goes blank. |
| USSD sessions in an in-process `Map` | Works in dev, breaks the moment you scale. |
| Work before acknowledging a callback | Sessions time out; duplicates pile up. |
| `rejectUnauthorized: false` shipped | Your credentials become interceptable. |

---

## Quick start

```bash
# 1. Configure
cp templates/.env.example .env
$EDITOR .env                       # credentials, then uncomment ONLY the endpoints
                                   # for the APIs enabled on your application

# 2. Confirm your egress IP is whitelisted — run this ON THE SERVER
curl -4 https://myip.ideamart.io   # add the result to Allowed Host Addresses in the portal

# 3. Verify connectivity and credentials
./scripts/smoke-test.sh            # Windows: .\scripts\smoke-test.ps1

# 4. Test your callback handlers — no Ideamart account needed
./scripts/test-callbacks.sh http://localhost:3000
```

Then ask your agent:

> Add Ideamart subscription and SMS to this app — users opt in by SMS keyword, get a welcome
> message, and can text STOP to unsubscribe.

---

## What's inside

```
SKILL.md · AGENTS.md              Entry points (Claude Code / everyone else)
catalog/ideamart-api.json         The whole contract as structured data
tools/ideamart.mjs                Offline CLI over the catalog
references/                       10 guides: per-service, callbacks, codes, security, go-live
templates/                        .env.example + working TypeScript (config, client, types,
                                  callback handlers, USSD session store)
skills/ · commands/               7 task skills and their slash commands
scripts/                          Smoke tests (bash + PowerShell), callback tests, rule sync
docs/agent-support.md             Which agent reads which file
```

---

## Development

```bash
npm test                             # catalog + tooling tests
node scripts/sync-rules.mjs --check  # agent rule copies in sync with AGENTS.md
node scripts/sync-rules.mjs          # regenerate them
```

`AGENTS.md` is the single source for every agent rule file; the seven copies are generated and
CI fails if they drift. The test suite verifies that every referenced status code exists, every
parameter is fully specified, every documented sample validates against its own schema, and no
credential-shaped string is committed.

See [CONTRIBUTING.md](CONTRIBUTING.md). Corrections to the API contract are the most valuable
contribution — cite the docs page or paste the observed response.

---

## Sources and honesty

Everything derives from the official documentation at
[docs.ideamart.io](https://docs.ideamart.io) — SMS, USSD, Subscription, OTP, Charging, LBS and
Response Codes — plus the IdeaPro provisioning guides, verified against a working integration.

Where the official documentation is internally inconsistent, the skill says so and tells the
agent to handle both cases rather than silently picking one:

- the delivery-report timestamp is documented as `yyMMddHHmm` but sampled as `yyyyMMddHHmmss`
- the LBS sample's latitude and longitude values appear transposed for Sri Lanka
- `action` is documented as a string but accepted as a number
- the balance-query sample omits the `tel:` prefix every other service requires

Ideamart evolves. Re-check the official docs for anything security- or money-critical, and
confirm with support what your application is actually provisioned for.

## Support

- **Email** — `info@ideamart.io`
- **WhatsApp** — +94767412345

Quote your `requestId` / `externalTrxId` / `sessionId` and the `statusCode` — that is what
support traces with.

## Security

No secrets in this repo; every credential is a placeholder and CI enforces it. The CLI makes
no network calls and never reads your credentials. See [SECURITY.md](SECURITY.md), and read
`scripts/smoke-test.*` before running it — `--with-charge` moves real money.

## License

[MIT](LICENSE).

---

<sub>Not an official Ideamart or Dialog Axiata product. Verify anything security- or
billing-critical against the official documentation before going live.</sub>
