# LBS and IVR

## LBS — Location Based Services

The LBS API returns a subscriber's real-time network location, including for feature phones
with no GPS. This is a **network-derived** location (cell/VLR based), not handset GPS —
accuracy is measured in hundreds of metres, not metres.

```
POST https://api.dialog.lk/lbs/locate
Content-Type: application/json
```

> LBS uses the `api.dialog.lk` host, **not** `api.ideamart.io`. Keep it in a separate config
> value (`IDEAMART_LBS_URL`) rather than composing it from the main base URL.

### Request

Full request:

```json
{
  "applicationId": "APP_001768",
  "password": "…",
  "subscriberId": "tel:94771234567",
  "serviceType": "IMMEDIATE",
  "responseTime": "NO_DELAY",
  "freshness": "HIGH",
  "horizontalAccuracy": "1500",
  "version": "2.0"
}
```

Mandatory-only request:

```json
{
  "applicationId": "APP_001764",
  "password": "…",
  "subscriberId": "tel:94771234567",
  "serviceType": "IMMEDIATE"
}
```

| Parameter | Description | Type | Mandatory |
|---|---|---|---|
| `applicationId` | Application ID from provisioning | String | **Mandatory** |
| `password` | Password from provisioning | String | **Mandatory** |
| `subscriberId` | MSISDN whose location is requested. May be masked. **One subscriber per request.** | String | **Mandatory** |
| `serviceType` | MLP service type. Currently only `IMMEDIATE` is supported. | Enum | **Mandatory** |
| `version` | API version (`1.0`, `2.0`) | String | Optional — defaults to latest |
| `responseTime` | Accepted delay: `NO_DELAY` > `LOW_DELAY` > `DELAY_TOLERANCE` | Enum | Optional |
| `horizontalAccuracy` | Required accuracy in metres: `100` > `500` > `1000` > `1500` | Enum | Optional |
| `freshness` | Required freshness: `HIGH_LOW` > `LOW_HIGH` > `HIGH` > `LOW` | Enum | Optional |

### QoS precedence — the part that trips people up

`responseTime`, `horizontalAccuracy` and `freshness` are **capped by what your app was
provisioned for**. You may request your provisioned level or anything *weaker*, never
anything stronger:

- An app provisioned with `LOW_DELAY` **cannot** request `NO_DELAY`, but may request
  `LOW_DELAY` or `DELAY_TOLERANCE`.
- An app provisioned for `1000` m accuracy **cannot** request `100` or `500` m, but may
  request `1000` or `1500` m.
- An app provisioned with `LOW_HIGH` **cannot** request `HIGH_LOW`, but may request
  `LOW_HIGH`, `HIGH` or `LOW`.

Note the ordering is by *strictness*: for `horizontalAccuracy` the **smallest number (`100`)
is the highest precedence**, because it demands the most.

If you omit these fields entirely, the request is validated against your app's LBS NCS
configuration — which is the safest default. **Omit them unless you have a reason.** Requesting
a level above your provisioning fails with `E1367` (Request QoS not supported).

### Response

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "timeStamp": "20130405181744",
  "subscriberState": true,
  "latitude": "79.948944",
  "longitude": "6.707778",
  "horizontalAccuracy": "-7.0",
  "freshness": "8.0",
  "messageId": "101304051246360081",
  "version": "1.0"
}
```

| Parameter | Description | Type | Mandatory |
|---|---|---|---|
| `version` | API version | String | Mandatory |
| `messageId` | Uniquely identifies the request within the SDP | String | Always present |
| `latitude` | Latitude of the subscriber | String | Present on success only |
| `longitude` | Longitude of the subscriber | String | Present on success only |
| `freshness` | Actual freshness of the fix, **in minutes** | Integer | Mandatory |
| `horizontalAccuracy` | Actual accuracy of the fix, **in metres** | Integer | Mandatory |
| `subscriberState` | Handset power state: `true` = on, `false` = off | Boolean | Optional |
| `timeStamp` | Transaction date/time | Datetime | Present on success only |
| `statusCode` / `statusDetail` | Outcome | String | Mandatory |

Failure response — note there are no coordinates:

```json
{
  "statusCode": "E1303",
  "statusDetail": "IP address, which the request originates from, is not listed within the allowed-host-address list",
  "messageId": "101304051248020083",
  "version": "1.0"
}
```

### Implementation notes

- **`latitude` and `longitude` are strings** — parse them, and do not assume the field order
  matches convention. In the official sample the values are `"latitude": "79.948944"` and
  `"longitude": "6.707778"`, but for Sri Lanka latitude is ~6–10 and longitude is ~79–82, so
  the sample's values appear transposed. **Sanity-check coordinates against the expected
  region before using them**, and log anything out of range rather than plotting it.
- **Check `latitude`/`longitude` exist before reading them.** They are absent on every failure.
- **`freshness` is age in minutes** — a large value means you got a cached fix, not a live one.
  Decide a maximum acceptable age for your use case and reject staler results.
- **`horizontalAccuracy` is a radius in metres.** Treat the position as a circle, never a point.
  Do not build a geofence tighter than the accuracy you were given.
- **`subscriberState: false`** means the handset is off — the location, if any, is historical.
- **One subscriber per request.** Batch by looping with rate limiting, not by passing an array.

### Privacy — treat location as the most sensitive data you handle

Location history reveals home, workplace, and movement patterns. Standards higher than for
other fields apply:

- **Obtain and record explicit, purpose-specific consent** before locating anyone. Consent to
  receive SMS is not consent to be located.
- **Query only when there is a live user-facing reason** — never poll on a timer "just in case".
- **Store the minimum for the minimum time.** Prefer deriving the answer (inside/outside a
  zone) and storing that, rather than storing coordinates.
- **Set a short, enforced retention period** and actually delete.
- **Never log raw coordinates alongside an identifier** in application logs.
- **Never expose a location endpoint to your own client apps** without authorisation checks —
  the classic failure is an endpoint that locates any MSISDN the caller supplies.

---

## IVR / Voice

**IVR Developer documentation will be updated shortly**
<https://docs.ideamart.io> publishes SMS, USSD, Subscription, OTP, Charging and LBS only.

Do not invent endpoints, parameter names or status codes for IVR. If a user asks for it:

1. Tell them it is not in the public developer documentation.
2. Point them at support to ask whether voice/IVR is available for their operator and account:
   `info@ideamart.io`, WhatsApp +94767412345.
3. Offer the alternative that usually solves the real requirement: **USSD** covers interactive
   menus on any handset without needing voice, and **SMS** covers notification delivery.

### Extension pattern — adding a new service without restructuring

This skill is built so a new service (IVR, or anything else Ideamart later publishes) drops in
without touching existing code. When the specification arrives:

1. **Add a reference file** — `references/12-ivr.md` — with the same sections as the others:
   endpoint, request table, response table, callbacks, status codes, rules.
2. **Add the endpoint variable to config**, not to code — `IDEAMART_IVR_CALL_URL` in
   `.env.example` and in the endpoint map of whichever config module your stack uses
   (`endpoints` in TypeScript, `_ENDPOINT_VARS` in Python, `ENDPOINT_VARS` in Java/PHP,
   `endpointVars` in Go, `EndpointVariables` in C#).
3. **Add request/response types** where your template keeps them.
4. **Add one wrapper function** to the client. It reuses the same `post()` helper, so it
   inherits credential injection, timeouts, retries, error mapping and logging for free:
   ```
   function placeIvrCall(input):
       return post("ivr-call", requireEndpoint("ivrCall"), input)
   ```
5. **Add a callback route** if the service pushes notifications, following the shape in
   [07-callbacks.md](07-callbacks.md).
6. **Add a row to the service map** in [SKILL.md](../SKILL.md) and a smoke test in
   `scripts/`.

Every Ideamart API shares one envelope — `applicationId` + `password` in, `statusCode` +
`statusDetail` out. Any new service will too. Do not build a parallel client for it.
