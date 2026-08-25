---
name: ideamart-help
description: Quick reference for the Ideamart skill — available commands, services (telco and OmniAI), and which reference document covers what. Use when the user asks what the Ideamart skill can do.
---

# Ideamart skill — quick reference

## Tooling

```bash
node tools/ideamart.mjs help        # every command
node tools/ideamart.mjs list        # every service and callback
node tools/ideamart.mjs platform    # base URLs, operators, conventions
node tools/ideamart.mjs omniai      # the OmniAI AI gateway: auth, models, errors
```

Offline, zero-dependency, read-only, and it never sees your credentials. Add `--json` to any
command for machine-readable output.

| Command | Answers |
|---|---|
| `list [category]` | What services exist? |
| `show <id>` | What exactly does this call take and return? |
| `search "<query>"` | Which service does the thing I want? |
| `curl <id> [k=v]` | Give me a runnable request, with the parameters and response defined. |
| `validate <id> '<json>'` | Is this payload correct? |
| `code <statusCode>` | What does this error mean and what do I do? |
| `diagnose "<symptom>"` | Why is this not working? |
| `practices [severity]` | What must I not get wrong? |
| `checklist` | Am I ready for production? |
| `reference <doc>` | Show me the full guide. |
| `omniai [models\|errors]` | How do I call the AI gateway, and what can go wrong? |

## Skills

| Skill | Use it for |
|---|---|
| `ideamart` | General Ideamart work; the rules and the service map |
| `ideamart-scaffold` | Starting a new integration |
| `ideamart-callbacks` | Inbound webhooks |
| `ideamart-review` | Auditing existing code |
| `ideamart-debug` | A failing call or callback |
| `ideamart-golive` | The pre-production checklist |
| `ideamart-omniai` | The OmniAI AI gateway — chat completions and image generation |

## Services covered

**SMS** — send (MT), broadcast, receive (MO), delivery reports
**USSD** — send screens, receive input, session handling
**Subscription** — register, unregister, status, query base size, notifications
**OTP** — request, verify
**CaaS** — direct debit, balance query, charging notifications
**LBS** — locate a subscriber
**IVR** — not publicly documented; do not invent endpoints

**OmniAI** — chat completions (`claude-sonnet-4`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`,
`gpt-4o-mini`) and image generation (`gpt-image-1`). A **separate product**: its key goes in an
`Authorization` header, it returns real HTTP status codes rather than `S1000`, it has no
subscriber and no callbacks, and it needs its own client. `references/14-omni-ai.md`.

## References

`01-getting-started` · `02-sms` · `03-ussd` · `04-subscription` · `05-caas` · `06-lbs-ivr` ·
`07-callbacks` · `08-status-codes` · `09-security-best-practices` · `10-production-checklist` ·
`11-any-stack` · `12-implementation-playbook` · `13-curl-reference` · `14-omni-ai`

## Writing the call

**`references/13-curl-reference.md`** is where every call comes from: each endpoint at the wire
— a runnable curl, every parameter defined, the response, every response field explained, that
endpoint's status codes — plus all five callbacks with a replay command and both OmniAI
endpoints with their own auth and error tables. Translate the request into the project's own
HTTP client; that is the integration.

```bash
node tools/ideamart.mjs curl subscription-query-base            # the cheapest call to prove setup
node tools/ideamart.mjs curl sms-send message="Hi" \
  destinationAddresses='["tel:94771234567"]'                    # filled in and validated
node tools/ideamart.mjs reference 13-curl-reference             # the whole page
```

There is no code generator: an emitter would cover a few languages and age with their idioms,
where a curl is the same call in all of them and stays true.

## Languages

The integration can be written in **any** language — Ideamart is JSON over HTTPS. The curl
reference covers every endpoint with no tooling at all; worked implementations ship for
TypeScript/Node, Python, Java, Go, PHP and C# (`templates/README.md`) to read for shape; and
`references/11-any-stack.md` specifies the same seven components language-neutrally for
anything else. The CLI above needs Node, but it is only a documentation reader.

## The things to remember

1. **HTTP 200 does not mean success** — branch on `statusCode`.
2. **Credentials live in environment variables**, and Ideamart is called from the backend only.
3. **Charging is idempotent on `externalTrxId`**, or you double-charge a real person.
4. **OmniAI follows none of the above** — header auth, real HTTP status codes, its own key and
   its own balance. Keep it in a separate client.

Support: `info@ideamart.io` · WhatsApp +94767412345 · <https://docs.ideamart.io>
