---
name: ideamart-callbacks
description: Implement Ideamart inbound webhooks — MO SMS receive, SMS delivery reports, USSD receive, subscription notifications and charging notifications. Use when building or debugging Ideamart callback handlers, notification URLs, or webhook endpoints.
---

# Ideamart callbacks

Ideamart POSTs to URLs you register during provisioning. Skip these and MO SMS never arrives,
USSD does not work, and you never learn that a subscriber left or a charge failed.

```bash
node tools/ideamart.mjs list --direction=inbound            # all five
node tools/ideamart.mjs show ussd-receive                   # payload + rules
node tools/ideamart.mjs codegen callbacks --lang=<language> # all five handlers, written
node tools/ideamart.mjs codegen ussd-receive --lang=<lang>  # just one
node tools/ideamart.mjs curl sms-mo                         # a test command for your handler
```

## The contract — identical for all five

**In:** `POST`, JSON, containing your `applicationId`.
**Out:** HTTP 200 with `{"statusCode":"S1000","statusDetail":"Success"}`.

The response is an **acknowledgement, not a reply**. For USSD, the screen the user sees comes
from a separate `POST /ussd/send`.

## Five rules

1. **Acknowledge first, work second.** Queue the payload, return `S1000`, process out of band —
   through the stack's real background mechanism (a queue, `BackgroundTasks`, `@Async`, a worker
   goroutine, a hosted service), never a bare `await`. USSD sessions time out in seconds.
2. **Be idempotent.** Every callback can arrive twice. Dedupe on the documented key —
   `node tools/ideamart.mjs show <id>` gives it.
3. **Never trust the body.** Unauthenticated JSON from the internet. Validate the schema,
   verify `applicationId`, restrict by Ideamart source IP, rate-limit.
4. **Always return 200**, even for payloads you reject — a 4xx/5xx just triggers redelivery.
5. **Log for tracing, not surveillance.** `requestId`/`sessionId`/`externalTrxId` yes; message
   bodies and unmasked `subscriberId` no.

## Test without an Ideamart account

The payloads are fully specified, so post them yourself:

```bash
./scripts/test-callbacks.sh http://localhost:3000
```

It covers valid, malformed, wrong-app, missing-field, oversized **and duplicate** payloads —
the duplicate test is the one people skip. It is plain curl, so it tests a handler written in
any language.

Working handlers, in the language of the host project:
`templates/typescript/callbacks-nextjs.ts` (Next.js), `templates/python/callbacks_fastapi.py`,
`templates/java/IdeamartCallbackController.java` (Spring), `templates/go/callbacks.go`,
`templates/php/callbacks.php`, `templates/csharp/IdeamartCallbacks.cs` (ASP.NET Core). For any
other stack, the per-language acknowledge-first table is in `references/11-any-stack.md`.

Full contract: `references/07-callbacks.md`.
