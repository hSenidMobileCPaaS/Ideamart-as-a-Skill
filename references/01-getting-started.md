# Getting Started with Ideamart

## What Ideamart is

Ideamart is Dialog Axiata's self-service telco platform for **Sri Lanka**. It lets an
independent developer or company ("service provider", SP) use carrier-grade capabilities —
sending SMS, running USSD menus, managing subscriptions, charging a user's mobile account,
locating a handset — through plain JSON-over-HTTPS APIs, without a direct operator
integration.

- **Portal:** <https://portal.ideamart.io>
- **Docs:** <https://docs.ideamart.io>
- **Site:** <https://ideamart.io>

### Operators

| Operator | Prefixes |
|---|---|
| Dialog | 070, 076, 077 |
| Hutch | 072, 078 |
| Airtel | 075 |

You choose which operators to provision per API. An application provisioned for Dialog only
cannot reach a Hutch or Airtel subscriber — so provision every operator whose subscribers you
intend to serve, and expect per-operator differences in charging configuration.

There is no fee to use the platform. The commercial model is revenue share on what the service
earns; the split is operator-dependent and is paid to the bank account registered on your
account.

## IdeaPro vs IdeaApp

| | IdeaPro | IdeaApp |
|---|---|---|
| Audience | Developers | Non-developers |
| You write the code | Yes | No |
| You host an endpoint | Yes — required | No |
| API access | Full | None (template services) |
| Customisation | Full | Template-bound |

**This skill is about IdeaPro.** If a user wants Alert / Voting / Contact / Services style
functionality with no code, IdeaApp templates in the portal may be a better answer than an
integration — say so rather than building it.

## Before you provision

The portal asks for things that must already exist. Get these ready first:

1. **A hosted, publicly reachable HTTPS endpoint.** The platform pushes MO SMS, USSD requests,
   subscription notifications, and charging notifications *to you*. Without a live URL these
   flows cannot be configured. `localhost` will not work — use a tunnel (ngrok, Cloudflare
   Tunnel) for development only.
2. **The static egress IP of the server that will call Ideamart.** Run, on that server:
   ```bash
   curl -4 https://myip.ideamart.io
   ```
   This is what goes in *Allowed Host Addresses*. A laptop IP, a CI runner IP, or a rotating
   serverless IP will fail with `E1303` in production.
3. **A decision on charging** — amount, currency, frequency, and the reason. This must be
   disclosed to end users before they subscribe.
4. **A decision on which operators and which APIs** you need. You can only call what you
   provisioned.

## Provisioning walkthrough (IdeaPro)

Portal → log in → **IdeaPro** → **Create new App**.

### Basic details

| Field | What it means | Get this wrong and… |
|---|---|---|
| Application Name | Unique name for the app | Rejected as duplicate |
| Application Description | Read by a human approver | Approval delayed; be specific about the use case |
| **Allowed Host Addresses** | IPs permitted to call the APIs | Every call fails `E1303` |
| **Whitelisted Numbers** | The only numbers allowed to use the app in Limited Production | Your test number silently does nothing |
| Blacklisted Numbers | Numbers barred from the app | — |

### Advanced details

- **Automatic content governance** — screens outbound content for inappropriate wording.
- **Advertisements** — attaches ads to messages you send.
- **Mobile number masking** — replaces subscriber MSISDNs with hash keys. **This changes
  what your code receives**: `subscriberId` becomes `tel:hu3b84346f…` rather than
  `tel:9477…`. Design for it from the start; treat the value as opaque.
- **Application start time / expiration** — schedule availability.

### Services

Per operator, per API, you configure the settings the platform needs — most importantly the
**callback URLs**. See [07-callbacks.md](07-callbacks.md) for what each one receives.

For SMS you additionally configure:

- **Shortcode** — the number users send SMS to (e.g. `77000`).
- **Keyword** — the unique word that routes an SMS to *your* app. A user texts
  `KEYWORD <anything>` to the shortcode.
- **MO enabled/disabled** — turn MO off if the service never receives user SMS.

For CaaS you configure the **Charging Notification URL**, whether **Enable Query Balance
Requests** is on, whether **subscription is required before charging**, and the operator-side
**Enable Debit Requests** / **Mobile Account for Operator** toggles (both must be `YES` for
charging to work). Max TPS and TPD are fixed per operator agreement.

## Approval states

1. **Draft** — you are still editing.
2. **Limited Production** — first approval. *Only whitelisted numbers can use the app.* This
   is your real integration-test environment.
3. **Production** — full subscriber base.

Budget for Limited Production being where you find every bug. Build with real credentials
against whitelisted test numbers.

## Credentials

Provisioning gives you two values:

```
applicationId   APP_001807       — identifies the app
password        cf2b9e361c13…    — authenticates it
```

These are a symmetric shared secret with full authority over your app, including the ability
to charge your subscribers real money. Handle them accordingly —
[09-security-best-practices.md](09-security-best-practices.md) is not optional reading.

## Environments

Ideamart does not publish a separate public sandbox host. Practical approach:

| Stage | Target | How |
|---|---|---|
| Local development | Your own mock | Run a local mock that speaks the same JSON contract; point `IDEAMART_BASE_URL` at it |
| Integration test | Real platform, Limited Production | Real credentials, whitelisted numbers only |
| Production | Real platform, Production | Same code, different env values |

The only thing that changes between them is environment variables:

```bash
IDEAMART_BASE_URL=http://localhost:4010        # local mock
IDEAMART_BASE_URL=https://api.ideamart.io      # limited production and production
```

Never branch on `NODE_ENV` inside client code to pick a URL — read the URL from config, so
the same binary runs everywhere. See
[templates/typescript/ideamart-config.ts](../templates/typescript/ideamart-config.ts).

## Your first call

The cheapest way to prove credentials, whitelisting and connectivity all work is Query Base —
it needs no subscriber and charges nothing:

```bash
curl -X POST 'https://api.ideamart.io/subscription/query-base' \
  --header 'Content-Type: application/json' \
  --data '{"applicationId":"'"$IDEAMART_APP_ID"'","password":"'"$IDEAMART_PASSWORD"'"}'
```

| Response | Meaning |
|---|---|
| `S1000` + `baseSize` | Everything works |
| `E1313` | Wrong `applicationId`/`password`, or the app is not active |
| `E1303` | This machine's IP is not in Allowed Host Addresses |
| `E1309` | Subscription API not provisioned for this app |
| Connection timeout | Network/firewall, or you are behind a proxy |

More smoke tests: [scripts/smoke-test.sh](../scripts/smoke-test.sh).

## Support

- Email: `info@ideamart.io`
- Hotline: 0773054056

When you contact support, quote the `requestId`, `externalTrxId` or `sessionId` and the
`statusCode` — that is what they trace with.
