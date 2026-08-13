# Callbacks (Inbound Webhooks)

Half of Ideamart is inbound. The platform `POST`s JSON to URLs you register during
provisioning. If you only build outbound calls, MO SMS never arrives, USSD never works, and
you never learn that a subscriber left or a charge failed.

## The callbacks

| Callback | Fires when | Configured under | Spec |
|---|---|---|---|
| **MO SMS Receive** | A user texts your shortcode+keyword | SMS API settings | [02-sms.md](02-sms.md) |
| **SMS Delivery Report** | An MT SMS sent with `deliveryStatusRequest:1` reaches a final state | SMS API settings | [02-sms.md](02-sms.md) |
| **USSD Receive** | A user dials your code or presses a key | USSD API settings | [03-ussd.md](03-ussd.md) |
| **Subscription Notification** | A subscription is created or removed, by anyone | Subscription API settings | [04-subscription.md](04-subscription.md) |
| **Charging Notification** | A charging request completes | CaaS *Charging Notification URL* | [05-caas.md](05-caas.md) |

> Four of these five have a published payload. **The charging notification does not** — the URL
> is a documented provisioning field, but its body is not specified anywhere. Log the raw body
> once in Limited Production and write that handler against what actually arrives.

## The contract — same for all of them

**In:** `POST`, `Content-Type: application/json`, a flat JSON object containing your
`applicationId`.

**Out:** HTTP 200 with

```json
{ "statusCode": "S1000", "statusDetail": "Success" }
```

That is the whole contract. There is no other response shape, and — importantly — **the
response body is an acknowledgement, not a reply**. For USSD in particular, the screen the
user sees comes from a separate `POST /ussd/send`, not from what you return here.

---

## Rules

### 1. Acknowledge first, work second

Respond `S1000` immediately, then process asynchronously. Never do a database write chain, a
third-party call, or an Ideamart call *before* responding.

USSD sessions time out in seconds. Delivery reports arrive in bursts. A slow handler causes
retries, duplicates, and dropped sessions.

```
handler(request):
    body = parse_json(request)          # malformed → still acknowledge
    enqueue(body)                       # hand off; do NOT wait for the work
    return 200, { "statusCode": "S1000", "statusDetail": "Success" }
```

"Enqueue" means the stack's real background mechanism — a queue or broker, `BackgroundTasks`
in FastAPI, `@Async` in Spring, a worker goroutine, a hosted service in .NET, a queued job in
Laravel. Not a bare `await`, and not "it's fast enough". The per-stack table is in
[11-any-stack.md](11-any-stack.md#6-callback-endpoints).

### 2. Be idempotent

Every callback can arrive more than once. Deduplicate on the natural key:

| Callback | Dedupe key |
|---|---|
| MO SMS | `requestId` |
| Delivery report | `requestId` + `deliveryStatus` |
| USSD | `requestId` |
| Subscription notification | `subscriberId` + `status` + `timeStamp` |
| Charging notification | whatever transaction id the real payload carries — confirm it first |

A duplicate charging notification that double-counts revenue is a real bug with real
consequences. Design for redelivery from the start.

### 3. Never trust the body

The payload is unauthenticated JSON from the public internet. Anyone who learns your URL can
post to it.

- **Validate the schema** — types, required fields, enum values. Reject anything else with
  `S1000` (acknowledge, discard) rather than crashing.
- **Verify `applicationId` matches yours.** Cheap, and it filters noise immediately.
- **Restrict by source IP** at the firewall, load balancer or middleware, to the Ideamart
  platform's egress ranges — ask support for the current list. This is the strongest control
  available, because Ideamart signs nothing and there is no signature to verify.
- **Never treat a callback as authorisation.** A `subscription-notification` claiming a user
  registered must not, by itself, unlock a paid feature — reconcile against your own state.
- **Never echo request content back** into an SMS or USSD screen without sanitising. That is
  how you become a spam relay.
- **Rate-limit the endpoint.** An unprotected callback URL is a free amplification target.

### 4. Always return 200

Return `S1000` even for payloads you reject. A 4xx/5xx makes the platform retry, and you get
the same bad payload again. Log it, alert on the pattern, and acknowledge.

The exception: if your handler is genuinely broken (database down) and you *want* redelivery,
a 5xx is correct — but only if you have verified the platform actually retries for that
callback type. Do not assume it does.

### 5. Log for traceability, not for surveillance

Log `requestId`, `sessionId`, `externalTrxId`, `statusCode`, and a timestamp. **Mask
`subscriberId` / `sourceAddress`** to last-3-digits. **Never log message bodies containing
user content** unless you have a stated reason and a retention policy — MO SMS content is user
communication.

---

## URL design

Choose paths before provisioning; changing them later means editing the provisioning record
in the portal, which needs re-approval in some states.

```
POST /api/ideamart/sms/mo
POST /api/ideamart/sms/dlr
POST /api/ideamart/ussd
POST /api/ideamart/subscription/notification
POST /api/ideamart/charging/notification
```

Requirements:

- **HTTPS with a valid, complete certificate chain.** Self-signed will not work.
- **Publicly reachable** — no VPN, no basic auth prompt, no Cloudflare challenge page. Bot
  protection that interrogates the client will silently break these; allowlist the callback
  paths.
- **Stable.** Do not put them behind a preview URL that rotates per deployment.
- Add an unguessable path segment (`/api/ideamart/x7f3k9/ussd`) as defence in depth — it is
  not authentication, but it stops opportunistic scanning.
- Exempt them from CSRF protection (they are machine-to-machine `POST`s with no cookie).
- Exempt them from any auth middleware — but then apply the IP restriction, or you have an
  open endpoint.

### Local development

Callbacks cannot reach `localhost`. Use a tunnel for development only:

```bash
cloudflared tunnel --url http://localhost:3000
# or
ngrok http 3000
```

Register the tunnel URL in the portal while testing, and remember it changes on restart with
free tiers. **Never leave a tunnel URL configured in a production app record.**

---

## Reference handler

The same five steps in every language and framework:

```
ACK = { "statusCode": "S1000", "statusDetail": "Success" }

handler(request):
    if not from_ideamart_ip(request):     return 200, ACK   # allowlist, if configured
    body = try_parse_json(request)
    if body is null:                      return 200, ACK   # malformed — acknowledge, discard
    if not schema_valid(body):            return 200, ACK   # log the pattern, do not crash
    if body.applicationId != config.applicationId:
                                          return 200, ACK   # someone else's payload
    if seen_before(dedupe_key(body)):     return 200, ACK   # redelivery
    enqueue("sms.mo", body)                                 # process out of band
    return 200, ACK
```

Note what never happens: no 4xx, no 5xx, no work before the response, no trust in the body.

Complete working routes for all five callbacks, per stack:

| Stack | File |
|---|---|
| TypeScript / Next.js | [templates/typescript/callbacks-nextjs.ts](../templates/typescript/callbacks-nextjs.ts) |
| Python / FastAPI | [templates/python/callbacks_fastapi.py](../templates/python/callbacks_fastapi.py) |
| Java / Spring | [templates/java/IdeamartCallbackController.java](../templates/java/IdeamartCallbackController.java) |
| Go / net/http | [templates/go/callbacks.go](../templates/go/callbacks.go) |
| PHP (framework-neutral, Laravel notes) | [templates/php/callbacks.php](../templates/php/callbacks.php) |
| C# / ASP.NET Core | [templates/csharp/IdeamartCallbacks.cs](../templates/csharp/IdeamartCallbacks.cs) |

Any other stack: [11-any-stack.md](11-any-stack.md).

---

## Testing callbacks

You do not need the platform to test a handler — the payloads are fully specified. Post them
yourself:

```bash
curl -X POST http://localhost:3000/api/ideamart/ussd \
  -H 'Content-Type: application/json' \
  -d '{"message":"*141#","ussdOperation":"mo-init","requestId":"1330933229901",
       "sessionId":"1330929317043","encoding":"440","sourceAddress":"tel:94771234567",
       "applicationId":"APP_000001","version":"1.0"}'
```

Build a test for each of: valid payload, malformed JSON, wrong `applicationId`, missing
required field, and **the same payload twice** (the idempotency test — the one people skip).

Ready-made payloads for every callback: [scripts/smoke-test.sh](../scripts/smoke-test.sh), and
all five written out field by field — what arrives, what you must respond, the dedupe key, and a
command that replays the exact payload against your route — in
[13-curl-reference.md](13-curl-reference.md).
