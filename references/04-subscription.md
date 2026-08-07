# Subscription API

The Subscription API manages the lifecycle that binds a user to your service, and — critically
— records their **consent**. Ideamart treats consent as a compliance matter: registering users
without it can get your application suspended.

Five things live here:

| Operation | Endpoint |
|---|---|
| **Register** (opt-in) | `POST /subscription/send` with `action: "1"` |
| **Unregister** (opt-out / unsub) | `POST /subscription/send` with `action: "0"` |
| **Subscription Status** | `POST /subscription/getStatus` |
| **Query Base** (subscriber base size) | `POST /subscription/query-base` |
| **Subscription Notification** | Your callback URL (inbound) |

Plus **OTP**, the registration flow for web and app users — documented at the end of this file.

---

## Register / Unregister

```
POST /subscription/send
Content-Type: application/json
```

### Register (opt-in)

```json
{
  "applicationId": "APP_001807",
  "password": "…",
  "version": "1.0",
  "action": "1",
  "subscriberId": "tel:94771234567"
}
```

```json
{
  "version": "1.0",
  "requestId": "1374746416574",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS",
  "subscriptionStatus": "REGISTERED"
}
```

### Unregister (opt-out)

Identical, with `action: "0"`:

```json
{
  "applicationId": "APP_001807",
  "password": "…",
  "version": "1.0",
  "action": "0",
  "subscriberId": "tel:94771234567"
}
```

```json
{
  "version": "1.0",
  "requestId": "1374746416574",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS",
  "subscriptionStatus": "UNREGISTERED"
}
```

### Request parameters

| Parameter | Description | Type | Mandatory |
|---|---|---|---|
| `applicationId` | Application ID from provisioning | String | **Mandatory** |
| `password` | Password from provisioning | String | **Mandatory** |
| `version` | API version (`1.0`, `2.0`…) | String | Optional — defaults to latest |
| `action` | `1` = opt in, `0` = opt out | Enum | **Mandatory** |
| `subscriberId` | `tel:`-prefixed subscriber address; may be a hash key if masking is on | String | **Mandatory** |

> The official docs send `action` as a **string** (`"1"` / `"0"`). Numeric `1` / `0` is also
> accepted in practice. Use the string form — it matches the published contract.

### Response parameters

| Parameter | Description |
|---|---|
| `version` | API version |
| `requestId` | Uniquely identifies the request within the SDP |
| `statusCode` / `statusDetail` | Outcome |
| `subscriptionStatus` | `REGISTERED`, `UNREGISTERED`, or `PENDING`. `PENDING CHARGE` means the subscriber has not been charged yet. |

### Rules that matter

- **Consent before Register, always.** A user tapping "Subscribe", replying to a USSD prompt,
  or verifying an OTP is consent. Importing a list of numbers is not. Store *what* the user
  agreed to, *when*, and *through which channel* — you may be asked to produce it.
- **Disclose the charge before registering** — amount, currency, frequency. This is a
  provisioning-level obligation, not a nicety.
- **Unregister must be as easy as register.** Provide it in every channel the user can reach:
  an `UNSUB` / `STOP` keyword over MO SMS, a USSD menu option, and a button in-app. Honour it
  immediately.
- **`E1351` (already registered) on a Register is not an error in your flow** — it means the
  user is already on. Treat it as success and continue.
- **`E1356` (not registered) on an Unregister is likewise benign** — the desired end state
  already holds. Make both operations idempotent from the caller's point of view.
- **Registration may be `PENDING`, not `REGISTERED`.** If initial charging is involved the
  subscriber is not active yet. Do not start delivering the service on `PENDING`; wait for the
  subscription notification.
- **Mirror subscription state in your own database.** Do not call `getStatus` on every request
  — it is slow, rate-limited, and unnecessary if you consume notifications.

---

## Subscription Status

Checks the current state of one subscriber.

```
POST /subscription/getStatus
Content-Type: application/json
```

```json
{
  "applicationId": "APP_001807",
  "password": "…",
  "subscriberId": "tel:94771234567"
}
```

```json
{
  "version": "1.0",
  "subscriptionStatus": "REGISTERED",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS"
}
```

| Request parameter | Description | Mandatory |
|---|---|---|
| `applicationId` | Application ID | **Mandatory** |
| `password` | Password | **Mandatory** |
| `subscriberId` | Subscriber address, `tel:` prefixed, possibly masked | **Mandatory** |

| Response parameter | Description | Mandatory |
|---|---|---|
| `version` | API version | Mandatory |
| `subscriptionStatus` | `REGISTERED` / `UNREGISTERED` / `PENDING` / `CHARGE` | Optional |
| `statusCode` / `statusDetail` | Outcome | Mandatory |

Use it for reconciliation (a nightly sweep, or when a user disputes their state) — not as a
per-request gate.

---

## Query Base — subscriber base size

Returns how many subscribers are currently registered to the application. Needs no subscriber
and costs nothing, which also makes it the ideal connectivity smoke test.

```
POST /subscription/query-base
Content-Type: application/json
```

```json
{
  "applicationId": "APP_001807",
  "password": "…"
}
```

```json
{
  "version": "1.0",
  "baseSize": "10",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS"
}
```

| Request parameter | Description | Mandatory |
|---|---|---|
| `applicationId` | Application ID | **Mandatory** |
| `password` | Password | **Mandatory** |

| Response parameter | Description | Mandatory |
|---|---|---|
| `version` | API version | Mandatory |
| `baseSize` | Current subscriber base size — **a string, parse it** | Optional |
| `statusCode` / `statusDetail` | Outcome | Mandatory |

Notes:

- `baseSize` comes back as a **string**. Coerce before arithmetic or charting.
- It is a point-in-time count for the whole app, not a per-operator or per-segment figure.
- Poll it on a schedule (hourly/daily) into your own metrics store rather than calling it per
  page load. Use it to sanity-check a broadcast before sending to `tel:all` — if `baseSize` is
  far larger than you expect, stop.

---

## Subscription Notification (inbound)

The platform `POST`s to the **Subscription Notification URL** configured during provisioning
whenever a subscription changes — including changes you did not initiate (a user texting
`STOP`, an operator-side removal, a billing failure).

```json
{
  "applicationId": "APP_001807",
  "frequency": "Monthly",
  "status": "REGISTERED",
  "subscriberId": "tel:94771234567",
  "version": "1.0",
  "timeStamp": "20130402025896"
}
```

| Field | Meaning |
|---|---|
| `applicationId` | Your application ID |
| `status` | `REGISTERED` / `UNREGISTERED` |
| `subscriberId` | Subscriber address, possibly masked |
| `frequency` | Charging frequency for the subscription (e.g. `Monthly`) |
| `timeStamp` | When it happened |
| `version` | API version |

Respond `{"statusCode":"S1000","statusDetail":"Success"}`.

**This callback is the authoritative source of subscription state.** Consuming it is what lets
you keep a local mirror instead of polling `getStatus`. Handle it idempotently — duplicates
happen. Full contract: [07-callbacks.md](07-callbacks.md).

---

## OTP — registering users from web and mobile apps

When the user starts on a screen rather than on the network (a website form, an app sign-up),
you cannot get their MSISDN from the carrier. OTP solves that: the user types their number,
the platform SMSes a PIN, and on successful verification you receive the **masked
`subscriberId`** to use with every other API.

API version 1.2. Endpoints work on `api.ideamart.io` or `api.dialog.lk`.

### Flow

1. Collect the mobile number in your UI.
2. `POST /subscription/otp/request` → platform SMSes a PIN.
3. Store the returned `referenceNo` server-side against the user's session.
4. Collect the PIN in your UI.
5. `POST /subscription/otp/verify` with `referenceNo` + `otp`.
6. Store the returned `subscriberId` — this is what you use for SMS, Subscription and Charging.

**Always call these from a backend with a static IP**, never from the browser or the app.

### OTP Request

```
POST /subscription/otp/request
```

```json
{
  "applicationId": "APP_001100",
  "password": "…",
  "subscriberId": "tel:94777123123",
  "applicationHash": "y3b84346f63899a",
  "applicationMetaData": {
    "client": "MOBILEAPP",
    "device": "Samsung S10",
    "os": "android8",
    "appCode": "https://play.google.com/store/apps/details?id=lk.example.app"
  }
}
```

| Field | What to put in it |
|---|---|
| `applicationHash` | A UUID you generate per request, for tracing |
| `client` | `MOBILEAPP`, `WebSite`, or `DESKTOP` |
| `device`, `os` | Real device details — derive from the User-Agent for web |
| `appCode` | Mobile app: package name or store URL. Website: the page URL. Desktop: download URL. |

Success:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "referenceNo": "3b84346f63899a32ec742a676532ec74dffe4f5",
  "version": "1.0"
}
```

Already registered:

```json
{ "statusDetail": "user already registered", "version": "1.0", "statusCode": "E1351" }
```

### OTP Verify

```
POST /subscription/otp/verify
```

```json
{
  "applicationId": "APP_001100",
  "password": "…",
  "referenceNo": "3b84346f63899a32ec742a676532ec74dffe4f5",
  "otp": "123564"
}
```

Success:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "subscriptionStatus": "REGISTERED",
  "version": "1.0",
  "subscriberId": "tel:hu3b84346f63899a32ec742a666503a02a4dffe4f5"
}
```

Errors:

| Code | Meaning |
|---|---|
| `E1850` | Invalid OTP |
| `E1851` | OTP expired |
| `E1852` | Maximum attempts reached |

### OTP rules

- **One OTP is valid for 60 minutes.**
- **Maximum 3 verification attempts per OTP.** After that, the user must request a new one.
- **`referenceNo` lives server-side, in the session.** Never send it to the client, never put
  it in a URL, never let the client choose it — that would let an attacker verify against
  someone else's OTP request.
- **Rate-limit OTP requests yourself**, per number and per IP. Without it your app becomes an
  SMS-bombing tool aimed at arbitrary Sri Lankan phone numbers, at your expense.
- **The `subscriberId` you get back is the masked identifier.** Store it as the user's
  identity for all later Ideamart calls. Do not store the raw MSISDN the user typed unless you
  genuinely need it, and if you do, protect it as PII.
- Never log the OTP.
