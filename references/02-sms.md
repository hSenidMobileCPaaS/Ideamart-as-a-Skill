# SMS API

Three distinct services, two directions:

| Service | Direction | Who initiates | Where it happens |
|---|---|---|---|
| **Send** (MT — Mobile Terminated) | App → user | You | `POST /sms/send` |
| **Receive** (MO — Mobile Originated) | User → app | Subscriber | Your MO callback URL |
| **Delivery Status Report** | Platform → app | Platform | Your DLR callback URL |

Endpoint from `IDEAMART_SMS_SEND_URL` (production `https://api.ideamart.io/sms/send`). If that
variable is unset, the SMS API is not enabled on your application.

---

## Send Service (MT)

```
POST /sms/send
Content-Type: application/json
```

### Minimal request

```json
{
  "message": "Hello",
  "destinationAddresses": ["tel:94771234567"],
  "password": "…",
  "applicationId": "APP_999999"
}
```

### Response

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "messageId": "MSG_000111",
  "version": "1.0"
}
```

Responses may also carry a `destinationResponses` array with per-recipient
`address`, `messageId`, `statusDetail` and `timeStamp` — read per-recipient results from
there when sending to multiple addresses, because a request can partially succeed.

### Request parameters

| Parameter | Description | Type | Mandatory |
|---|---|---|---|
| `applicationId` | Application ID from provisioning | String | **Mandatory** |
| `password` | Password from provisioning | String | **Mandatory** |
| `version` | API version (`1.0`, `2.0`…) | String | Optional — defaults to latest |
| `destinationAddresses` | **Array** of addresses. `tel:` prefix. May be a hash key if masking is on. `["tel:all"]` sends to the entire subscribed base. | String[] | **At least one** |
| `message` | Message body. Over-length messages are split by the platform. | String | **Mandatory** |
| `sourceAddress` | Sender address shown to the user — must be one of the provisioned alias values | String | Optional |
| `deliveryStatusRequest` | `0` = no delivery report, `1` = request delivery report | Enum | Optional — defaults to no report |
| `encoding` | `0` = Text, `240` = Flash SMS, `245` = Binary (message must be hex-encoded) | Enum | Optional — defaults to Text |
| `chargingAmount` | Charging amount, for variable-charge SMS services | String | Optional |

### Rules

- **`destinationAddresses` is an array, always** — even for one recipient. Sending a bare
  string is the single most common SMS integration bug.
- **`tel:all` is a broadcast to your whole subscriber base.** Guard it. It should never be
  reachable from an ordinary code path; require an explicit, separately-authorised call.
  Messages to a large base may be held for admin approval (`E1333`).
- **`sourceAddress` must be a provisioned alias.** An arbitrary value fails with `E1331`.
- **Set `deliveryStatusRequest: 1` only if you actually consume DLRs.** Otherwise you generate
  callback traffic you ignore.
- **Long messages are split and charged per part.** Keep under 160 GSM-7 characters
  (70 if the text contains non-Latin characters, which forces UCS-2) to stay at one part.
  Sinhala and Tamil text is UCS-2 — budget 70 characters.
- **Never put a password, OTP that the user did not request, or full PII in an SMS body.**
- `E1334` / `E1335` mean the message exceeded the configured maximum length.

### Broadcast example

```json
{
  "applicationId": "APP_999999",
  "password": "…",
  "destinationAddresses": ["tel:all"],
  "message": "Service update: …",
  "deliveryStatusRequest": "0"
}
```

---

## Receive Service (MO)

The platform `POST`s to **your** MO callback URL when a subscriber sends an SMS to your
shortcode with your keyword. You do not call anything.

### What you receive

```json
{
  "message": "my testing message",
  "sourceAddress": "tel:94771234567",
  "requestId": "APP_000001",
  "encoding": "0",
  "version": "1.0"
}
```

| Parameter | Description | Type | Mandatory |
|---|---|---|---|
| `version` | API version | String | Mandatory |
| `applicationId` | Your application ID | String | Mandatory |
| `sourceAddress` | Sender address — masked if masking is enabled | String | Mandatory |
| `message` | Message as sent by the user | String | Mandatory |
| `requestId` | Unique request identifier within Ideamart | String | Mandatory |
| `encoding` | `0` Text / `240` Flash / `245` Binary (hex-encoded) | Enum | Mandatory |

### What you must respond

```json
{ "statusCode": "S1000", "statusDetail": "Success" }
```

Respond **immediately**, before doing any real work. Full callback contract:
[07-callbacks.md](07-callbacks.md).

### Handling MO content

The user's message arrives with the keyword included — a user texting `WEATHER Colombo` to
your shortcode gives you a `message` containing the keyword and the argument. Parse
defensively:

- Trim, collapse whitespace, and compare the keyword case-insensitively.
- Treat anything after the keyword as free text; users send typos, emoji and empty strings.
- Recognise standard opt-out words (`STOP`, `UNSUB`, `OFF`) and honour them by calling
  Unregister — see [04-subscription.md](04-subscription.md). Ignoring an opt-out word in an
  MO message is both a compliance problem and a support-cost problem.
- MO messages are **not** authenticated beyond the source address. Do not perform a
  destructive or chargeable action purely on the content of one MO SMS.

---

## Delivery Status Report Service

If you sent with `deliveryStatusRequest: 1`, the platform `POST`s the outcome to your DLR
callback URL. Match it to the original send via `requestId`.

### What you receive

```json
{
  "destinationAddress": "tel:94771234567",
  "timeStamp": "20120113082110",
  "requestId": "MSG_000111",
  "deliveryStatus": "DELIVERED"
}
```

| Parameter | Description | Mandatory |
|---|---|---|
| `destinationAddress` | Subscriber address | Mandatory |
| `timeStamp` | Documented as `yyMMddHHmm`; samples show 14-digit `yyyyMMddHHmmss`. **Parse both lengths leniently.** | Mandatory |
| `requestId` | Ties the report back to the original send | Mandatory |
| `deliveryStatus` | See enum below | Mandatory |

### `deliveryStatus` values

Ideamart → your application:

`DELIVERED`, `EXPIRED`, `DELETED`, `UNDELIVERABLE`, `ACCEPTED`, `UNKNOWN`, `REJECTED`

The underlying SMPP gateway uses the abbreviated forms `DELIVRD`, `EXPIRED`, `DELETED`,
`UNDELIV`, `ACCEPTD`, `UNKNOWN`, `REJECTD`. **Accept both spellings** — normalise on the way
in rather than assuming one set.

### Respond

```json
{ "statusCode": "S1000", "statusDetail": "Success" }
```

### Using DLRs well

- `ACCEPTED` is not `DELIVERED` — it means the network took the message, nothing more.
- Repeated `UNDELIVERABLE` for one subscriber usually means a dead number; stop messaging it
  and consider unregistering to avoid paying for nothing.
- Reports can arrive out of order, late, more than once, or never. Store the latest status
  keyed by `requestId` and make the handler idempotent.

---

## Implementation notes

- One `sendSms(to, message, opts)` function; never build the payload at call sites.
- Normalise recipients through a single `toTelAddress()` helper.
- Persist `requestId` at send time if you want DLRs to be matchable.
- Rate-limit your own sending: operator TPS/TPD limits are fixed per agreement, and exceeding
  them gets requests rejected rather than queued.

Working `sendSms` and MO/DLR handlers in six languages: [templates/](../templates/README.md).
Any other stack: [11-any-stack.md](11-any-stack.md).
