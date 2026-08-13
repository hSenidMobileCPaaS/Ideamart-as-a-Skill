---
name: ideamart-help
description: Quick reference for the Ideamart skill — available commands, services, and which reference document covers what. Use when the user asks what the Ideamart skill can do.
---

# Ideamart skill — quick reference

## Tooling

```bash
node tools/ideamart.mjs help        # every command
node tools/ideamart.mjs list        # every service and callback
node tools/ideamart.mjs platform    # base URLs, operators, conventions
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

## Skills

| Skill | Use it for |
|---|---|
| `ideamart` | General Ideamart work; the rules and the service map |
| `ideamart-scaffold` | Starting a new integration |
| `ideamart-callbacks` | Inbound webhooks |
| `ideamart-review` | Auditing existing code |
| `ideamart-debug` | A failing call or callback |
| `ideamart-golive` | The pre-production checklist |

## Services covered

**SMS** — send (MT), broadcast, receive (MO), delivery reports
**USSD** — send screens, receive input, session handling
**Subscription** — register, unregister, status, query base size, notifications
**OTP** — request, verify
**CaaS** — direct debit, balance query, charging notifications
**LBS** — locate a subscriber
**IVR** — not publicly documented; do not invent endpoints

## References

`01-getting-started` · `02-sms` · `03-ussd` · `04-subscription` · `05-caas` · `06-lbs-ivr` ·
`07-callbacks` · `08-status-codes` · `09-security-best-practices` · `10-production-checklist` ·
`11-any-stack` · `12-implementation-playbook` · `13-curl-reference`

## Writing the call

**`references/13-curl-reference.md`** is where every call comes from: each endpoint at the wire
— a runnable curl, every parameter defined, the response, every response field explained, that
endpoint's status codes — and all five callbacks with a replay command. Translate the request
into the project's own HTTP client; that is the integration.

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

## The three things to remember

1. **HTTP 200 does not mean success** — branch on `statusCode`.
2. **Credentials live in environment variables**, and Ideamart is called from the backend only.
3. **Charging is idempotent on `externalTrxId`**, or you double-charge a real person.

Support: `info@ideamart.io` · WhatsApp +94767412345 · <https://docs.ideamart.io>
