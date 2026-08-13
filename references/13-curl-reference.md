<!-- Generated from catalog/ideamart-api.json by scripts/build-curl-reference.mjs. Do not edit directly. -->

# Every Endpoint as curl

The whole Ideamart contract at the wire: each endpoint, each parameter defined, a request you
can run, and the response it returns. No SDK, no generated code, no tooling of any kind between
you and the platform.

**Write the integration from this page, in whatever language the project already uses.** There
is deliberately no code generator in this skill: a generator would privilege a handful of
languages and rot as their idioms move, while the request below is the same call in all of
them. The body, the headers and the branching are identical whether it goes out through
`requests` in Python, `HttpClient` in Java or .NET, `net/http` in Go, Guzzle in PHP,
`Net::HTTP` in Ruby, `reqwest` in Rust, `HTTPoison` in Elixir or `fetch` in Node. Translate the
curl into the project's own HTTP client and idiom; keep everything else exactly as specified.

Run these against a real application to confirm provisioning and credentials before writing a
line of code — a working curl removes half the possible causes when the integration then fails.

---

## The shape of every call

```
POST  https://api.ideamart.io/<service-path>
Content-Type: application/json
```

- **Credentials travel in the JSON body**, as `applicationId` and `password`. There are no
  headers, no tokens, no signatures and no OAuth on this platform.
- **Every response is HTTP 200**, including failures. Ideamart returns HTTP 200 for application-level failures. Branch on statusCode, never on the HTTP status alone. S1000 is success.
- Every response carries `statusCode` and `statusDetail`; most also carry
  `version` and `requestId`.
- Subscriber addresses are always `tel:<msisdn>` — no `+`, no spaces.
  A masked application receives a hash (`tel:hu3b84346f…`) instead of a number; it is opaque,
  so send back exactly what you received.
- **LBS is on a different host** (`https://api.dialog.lk/lbs/locate`) from everything else.

## Before you run anything

Export your credentials and the endpoints your application is provisioned for. Every command on
this page reads them from the environment, so nothing here contains a credential and nothing you
copy can commit one.

```bash
export IDEAMART_APP_ID='APP_XXXXXX'
export IDEAMART_PASSWORD='…'                 # from the portal — never commit it
export IDEAMART_SMS_SEND_URL='https://api.ideamart.io/sms/send'
export IDEAMART_USSD_SEND_URL='https://api.ideamart.io/ussd/send'
export IDEAMART_SUBSCRIPTION_SEND_URL='https://api.ideamart.io/subscription/send'
export IDEAMART_SUBSCRIPTION_STATUS_URL='https://api.ideamart.io/subscription/getStatus'
export IDEAMART_SUBSCRIPTION_QUERY_BASE_URL='https://api.ideamart.io/subscription/query-base'
export IDEAMART_OTP_REQUEST_URL='https://api.ideamart.io/subscription/otp/request'
export IDEAMART_OTP_VERIFY_URL='https://api.ideamart.io/subscription/otp/verify'
export IDEAMART_CAAS_DEBIT_URL='https://api.ideamart.io/caas/direct/debit'
export IDEAMART_CAAS_BALANCE_URL='https://api.ideamart.io/caas/balance/query'
export IDEAMART_LBS_URL='https://api.dialog.lk/lbs/locate'
```

One variable per provisioned service, never one shared base URL: an application can only call
the APIs it was provisioned for, so an endpoint you have no variable for is one you must not
call. https://api.dialog.lk is an alias for https://api.ideamart.io and either works.

Windows PowerShell, where `curl` is an alias for `Invoke-WebRequest` and the syntax differs:

```powershell
$body = @{ applicationId = $env:IDEAMART_APP_ID; password = $env:IDEAMART_PASSWORD } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $env:IDEAMART_SUBSCRIPTION_QUERY_BASE_URL `
  -ContentType 'application/json' -Body $body
```

Three flags in every request below, all deliberate: `-sS` prints errors but not a progress bar,
`--max-time 15` stops a hung call holding a request thread, and `-d @- <<REQUEST` reads the body
from a heredoc so the credential variables expand and the JSON stays readable.

**Start with Query Base.** It needs no subscriber, costs nothing and touches no one, so it is
the safest way to prove that your credentials, your provisioning and your egress IP all work.

---

## Endpoint index

| Service | Endpoint | Environment variable |
|---|---|---|
| [SMS Send](#sms-send) | `POST https://api.ideamart.io/sms/send` | `IDEAMART_SMS_SEND_URL` |
| [USSD Send](#ussd-send) | `POST https://api.ideamart.io/ussd/send` | `IDEAMART_USSD_SEND_URL` |
| [Subscription Register](#subscription-register) | `POST https://api.ideamart.io/subscription/send` | `IDEAMART_SUBSCRIPTION_SEND_URL` |
| [Subscription Unregister](#subscription-unregister) | `POST https://api.ideamart.io/subscription/send` | `IDEAMART_SUBSCRIPTION_SEND_URL` |
| [Subscription Status](#subscription-status) | `POST https://api.ideamart.io/subscription/getStatus` | `IDEAMART_SUBSCRIPTION_STATUS_URL` |
| [Query Base (subscriber base size)](#query-base-subscriber-base-size) | `POST https://api.ideamart.io/subscription/query-base` | `IDEAMART_SUBSCRIPTION_QUERY_BASE_URL` |
| [OTP Request](#otp-request) | `POST https://api.ideamart.io/subscription/otp/request` | `IDEAMART_OTP_REQUEST_URL` |
| [OTP Verify](#otp-verify) | `POST https://api.ideamart.io/subscription/otp/verify` | `IDEAMART_OTP_VERIFY_URL` |
| [CaaS Direct Debit](#caas-direct-debit) | `POST https://api.ideamart.io/caas/direct/debit` | `IDEAMART_CAAS_DEBIT_URL` |
| [CaaS Query Balance](#caas-query-balance) | `POST https://api.ideamart.io/caas/balance/query` | `IDEAMART_CAAS_BALANCE_URL` |
| [LBS Get Location](#lbs-get-location) | `POST https://api.dialog.lk/lbs/locate` | `IDEAMART_LBS_URL` |

| Callback | Ideamart calls | Configured in |
|---|---|---|
| [MO SMS Receive](#mo-sms-receive) | `POST <your-host>/api/ideamart/sms/mo` | SMS API settings |
| [SMS Delivery Status Report](#sms-delivery-status-report) | `POST <your-host>/api/ideamart/sms/dlr` | SMS API settings |
| [USSD Receive](#ussd-receive) | `POST <your-host>/api/ideamart/ussd` | USSD API settings |
| [Subscription Notification](#subscription-notification) | `POST <your-host>/api/ideamart/subscription/notification` | Subscription API settings |
| [Charging Notification](#charging-notification) | `POST <your-host>/api/ideamart/charging/notification` | CaaS Charging Notification URL |

---

# Outbound services — you call Ideamart

---

## SMS Send

Send an MT (Mobile Terminated) SMS to one or more subscribers.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/sms/send` |
| **Environment variable** | `IDEAMART_SMS_SEND_URL` |
| **Content type** | `application/json` |
| **Full guide** | [02-sms.md](02-sms.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as given when provisioned. |
| `password` | string | **Required** | Password given when provisioned. |
| `version` | string | Optional | API version (1.0, 2.0). Defaults to latest. |
| `destinationAddresses` | string[] | **Required** | Array of tel:-prefixed addresses. Always an array, even for one recipient. tel:all targets the whole subscribed base. |
| `message` | string | **Required** | Message body. Over-length messages are split by the platform and charged per part. |
| `sourceAddress` | string | Optional | Sender address shown to the user. Must be a provisioned alias or the send fails with E1331. |
| `deliveryStatusRequest` | enum | Optional | 0 = no delivery report, 1 = request one. Defaults to 0. One of `0`, `1`. |
| `encoding` | enum | Optional | 0 = Text, 240 = Flash SMS, 245 = Binary (message hex-encoded). Defaults to Text. One of `0`, `240`, `245`. |
| `chargingAmount` | string | Optional | Charging amount for variable-charge SMS services. Number to two decimal places, in system currency (LKR). |
| `binaryHeader` | string | Optional | Hex-encoded UDH for advanced binary messages. Only meaningful with encoding 245. |

### Request

```bash
curl -sS -X POST "$IDEAMART_SMS_SEND_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "destinationAddresses": [
    "tel:94771234567"
  ],
  "message": "Hello"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "messageId": "MSG_000111",
  "version": "1.0"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `messageId` | string | Platform message identifier. |
| `version` | string | API version. |
| `destinationResponses` | object[] | Per-recipient results. A multi-recipient send can partially succeed, so branch on each entry's statusCode, not only the top-level one. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |
| `E1311` | configuration | MT flow is not allowed for this Application |
| `E1322` | configuration | Requested sender is not allowed |
| `E1323` | configuration | Requested recipients not allowed |
| `E1325` | client | Format of the address is invalid → Missing tel: prefix, or a + / space slipped in. |
| `E1331` | configuration | Sorry, invalid/unauthorized source address. Please check the availability of default sender address or aliases for SMS-MT in {0} application. → sourceAddress must be a provisioned alias. |
| `E1332` | transient | Delivery failed |
| `E1333` | user-state | Message contains suspected abusive content, or subscriber base is larger than the limit; will be stored for admin approval |
| `E1334` | client | Message length is too long. Maximum message length is {0} |
| `E1335` | client | Message length is too long. Maximum message length for advertisement messages is {0} |
| `E1341` | transient | Delivery failed. Errors occurred while sending the request for the intended destinations |
| `E1384` | configuration | International SMS sending is disabled |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- destinationAddresses is always an array.
- Guard tel:all behind a deliberate, separately-authorised code path.
- Keep under 160 GSM-7 characters for one part; Sinhala and Tamil are UCS-2, so budget 70.
- Only set deliveryStatusRequest to 1 if you consume the delivery-report callback.

---

## USSD Send

Send a USSD screen to a subscriber inside an active session.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/ussd/send` |
| **Environment variable** | `IDEAMART_USSD_SEND_URL` |
| **Content type** | `application/json` |
| **Full guide** | [03-ussd.md](03-ussd.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as given when provisioned. |
| `password` | string | **Required** | Password given when provisioned. |
| `version` | string | Optional | API version. Defaults to latest. |
| `message` | string | **Required** | Screen text sent to the handset. ~182 char limit; assume 160. |
| `sessionId` | string | **Required** | Session number assigned by the USSD gateway. Echo the one the platform sent you; never generate your own. |
| `ussdOperation` | enum | **Required** | mt-init starts an app-initiated session, mt-cont keeps it open, mt-fin closes it. One of `mt-init`, `mt-cont`, `mt-fin`. |
| `destinationAddress` | string | **Required** | tel:-prefixed subscriber address; may be a hash key. |
| `encoding` | enum | Optional | 440 = plain ASCII. One of `440`. |

### Request

```bash
curl -sS -X POST "$IDEAMART_USSD_SEND_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "version": "1.0",
  "message": "1. Press One\n2. Press Two\n3. Exit",
  "sessionId": "1330929317043",
  "ussdOperation": "mt-cont",
  "destinationAddress": "tel:94771234567",
  "encoding": "440"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "statusCode": "S1000",
  "timeStamp": "1203051205",
  "statusDetail": "Success",
  "requestId": "1330929317059",
  "version": "1.0"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `requestId` | string | Uniquely identifies the request within Ideamart. |
| `timeStamp` | string | Processed timestamp. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |
| `E1383` | configuration | USSD network initiated flow not allowed |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Echo the platform's sessionId. A wrong one orphans the session.
- Terminal screens must use mt-fin, or the session hangs until the network times it out.
- Plain ASCII only (encoding 440) — no emoji, no Sinhala/Tamil script, no smart quotes.
- Reply fast: USSD sessions time out in seconds.

---

## Subscription Register

Opt a subscriber in to the application.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/subscription/send` |
| **Environment variable** | `IDEAMART_SUBSCRIPTION_SEND_URL` |
| **Content type** | `application/json` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as received when provisioned. |
| `password` | string | **Required** | Password as received when provisioned. |
| `version` | string | Optional | API version. Defaults to latest. |
| `action` | enum | **Required** | 1 = opt in. Send the string "1". One of `1`. |
| `subscriberId` | string | **Required** | tel:-prefixed subscriber address; may be masked. |

### Request

```bash
curl -sS -X POST "$IDEAMART_SUBSCRIPTION_SEND_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "version": "1.0",
  "action": "1",
  "subscriberId": "tel:94771234567"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "version": "1.0",
  "requestId": "1374746416574",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS",
  "subscriptionStatus": "REGISTERED"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `requestId` | string | Uniquely identifies the request within the SDP. |
| `subscriptionStatus` | enum | REGISTERED, UNREGISTERED or PENDING. PENDING CHARGE means the subscriber has not been charged yet. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |
| `E1317` | user-state | MSISDN in the request is in an invalid state (may be blocked, or have an invalid number of digits) |
| `E1324` | configuration | Subscription via HTTP is not allowed |
| `E1351` | user-state | User already registered **Treat this as success.** |
| `E1342` | user-state | Sorry, your phone number is blacklisted to use this application {0} |
| `E1343` | user-state | Non-whitelisted mobile number accessing services of application {0} → In Limited Production, only numbers in Whitelisted Numbers can use the app. |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Only call with explicit, recorded consent. Disclose amount and frequency before registering.
- E1351 (already registered) is success — the desired state already holds.
- A PENDING result is not active yet; wait for the subscription notification before delivering the service.

---

## Subscription Unregister

Opt a subscriber out of the application.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/subscription/send` |
| **Environment variable** | `IDEAMART_SUBSCRIPTION_SEND_URL` |
| **Content type** | `application/json` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as received when provisioned. |
| `password` | string | **Required** | Password as received when provisioned. |
| `version` | string | Optional | API version. Defaults to latest. |
| `action` | enum | **Required** | 0 = opt out. One of `0`. |
| `subscriberId` | string | **Required** | tel:-prefixed subscriber address; may be masked. |

### Request

```bash
curl -sS -X POST "$IDEAMART_SUBSCRIPTION_SEND_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "version": "1.0",
  "action": "0",
  "subscriberId": "tel:94771234567"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "version": "1.0",
  "requestId": "1374746416574",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS",
  "subscriptionStatus": "UNREGISTERED"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `requestId` | string | Uniquely identifies the request within the SDP. |
| `subscriptionStatus` | enum | UNREGISTERED on success. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |
| `E1356` | user-state | User not registered **Treat this as success.** |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Unregister must be as easy as register — offer it over MO SMS (STOP/UNSUB/OFF), USSD and in-app.
- E1356 (not registered) is success — the desired state already holds.
- Honour it immediately, including cancelling queued and scheduled messages.

---

## Subscription Status

Check the current subscription status of one subscriber.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/subscription/getStatus` |
| **Environment variable** | `IDEAMART_SUBSCRIPTION_STATUS_URL` |
| **Content type** | `application/json` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as received when provisioned. |
| `password` | string | **Required** | Password as received when provisioned. |
| `subscriberId` | string | **Required** | tel:-prefixed subscriber address; may be masked. |

### Request

```bash
curl -sS -X POST "$IDEAMART_SUBSCRIPTION_STATUS_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "subscriberId": "tel:94771234567"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "version": "1.0",
  "subscriptionStatus": "REGISTERED",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `subscriptionStatus` | enum | REGISTERED / UNREGISTERED / PENDING / CHARGE. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |
| `E1356` | user-state | User not registered |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Use for reconciliation, not as a per-request gate — mirror state locally from the subscription notification instead.

---

## Query Base (subscriber base size)

Return the number of subscribers currently registered to the application.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/subscription/query-base` |
| **Environment variable** | `IDEAMART_SUBSCRIPTION_QUERY_BASE_URL` |
| **Content type** | `application/json` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as received when provisioned. |
| `password` | string | **Required** | Password as received when provisioned. |

### Request

```bash
curl -sS -X POST "$IDEAMART_SUBSCRIPTION_QUERY_BASE_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "version": "1.0",
  "baseSize": "10",
  "statusCode": "S1000",
  "statusDetail": "SUCCESS"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `baseSize` | string | Current subscriber base size. Arrives as a string — coerce before arithmetic. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Needs no subscriber and costs nothing — the ideal connectivity and credential smoke test.
- baseSize is a string. Parse it.
- Poll on a schedule into your own metrics rather than per page load.
- Sanity-check it before any tel:all broadcast.

---

## OTP Request

Dispatch a one-time PIN by SMS so a web or app user can be registered from a plain mobile number.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/subscription/otp/request` |
| **Environment variable** | `IDEAMART_OTP_REQUEST_URL` |
| **Content type** | `application/json` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as received when provisioned. |
| `password` | string | **Required** | Password as received when provisioned. |
| `subscriberId` | string | **Required** | tel:-prefixed mobile number the user typed. |
| `applicationHash` | string | Optional | A UUID you generate per request, for tracing. |
| `applicationMetaData` | object | Optional | client (MOBILEAPP \| WebSite \| DESKTOP), device, os, appCode (package name / store URL / page URL / download URL). |

### Request

```bash
curl -sS -X POST "$IDEAMART_OTP_REQUEST_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "subscriberId": "tel:94771234567",
  "applicationHash": "y3b84346f63899a",
  "applicationMetaData": {
    "client": "MOBILEAPP",
    "device": "Samsung S10",
    "os": "android8",
    "appCode": "https://play.google.com/store/apps/details?id=lk.example.app"
  }
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "referenceNo": "3b84346f63899a32ec742a676532ec74dffe4f5",
  "version": "1.0"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `referenceNo` | string | Pass to OTP Verify. Keep server-side, in the session — never send it to the client. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1351` | user-state | User already registered |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Rate-limit per number AND per IP, or the app becomes an SMS-bombing tool at your expense.
- One OTP is valid for 60 minutes.
- Always call from a backend with a static IP.

---

## OTP Verify

Verify a PIN and receive the masked subscriberId to use with every other API.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/subscription/otp/verify` |
| **Environment variable** | `IDEAMART_OTP_VERIFY_URL` |
| **Content type** | `application/json` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID as received when provisioned. |
| `password` | string | **Required** | Password as received when provisioned. |
| `referenceNo` | string | **Required** | From the OTP Request response. Server-side only. |
| `otp` | string | **Required** | The PIN the user entered. |

### Request

```bash
curl -sS -X POST "$IDEAMART_OTP_VERIFY_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "referenceNo": "3b84346f63899a32ec742a676532ec74dffe4f5",
  "otp": "123564"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success",
  "subscriptionStatus": "REGISTERED",
  "version": "1.0",
  "subscriberId": "tel:hu3b84346f63899a32ec742a666503a02a4dffe4f5"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `subscriberId` | string | Masked subscriber identifier. Use this for SMS, Subscription and Charging from now on. |
| `subscriptionStatus` | enum | REGISTERED on success. |
| `version` | string | API version. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1850` | client | Invalid OTP → Maximum 3 attempts per OTP. |
| `E1851` | client | OTP request has expired → OTPs are valid for 60 minutes. |
| `E1852` | client | Maximum number of OTP attempts reached |
| `E1853` | client | No active OTP request found for this reference number |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Maximum 3 attempts per OTP — enforce it on your side too.
- Never log the OTP or the referenceNo.
- Store the returned masked subscriberId as the user's Ideamart identity.

---

## CaaS Direct Debit

Charge a specific amount from a subscriber's mobile account. Moves real money.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/caas/direct/debit` |
| **Environment variable** | `IDEAMART_CAAS_DEBIT_URL` |
| **Content type** | `application/json` |
| **Full guide** | [05-caas.md](05-caas.md) |

> **This call moves real money.** `externalTrxId` is the idempotency key: generate it,
> persist it *before* sending, and reuse it unchanged on every resolution attempt. A retry with
> a fresh one charges a real person twice.

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID generated when provisioning. |
| `password` | string | **Required** | Password authenticating the application. |
| `externalTrxId` | string | **Required** | Your transaction ID, mapping request to response. Max 32 characters. Persist BEFORE calling — it is the idempotency key. |
| `subscriberId` | string | **Required** | MSISDN or hash key of the subscriber to charge. |
| `amount` | string | **Required** | Amount to charge, sent as a string. Hold as a decimal type in your own code. |
| `paymentInstrument` | string | Optional | The account the debit is performed on, e.g. MobileAccount. Omit it unless your provisioning pins the debit to a specific instrument. |
| `accountId` | string | Optional | Account of the payment instrument. |
| `currency` | string | Optional | Currency of the amount. LKR for Sri Lanka. |

### Request

```bash
curl -sS -X POST "$IDEAMART_CAAS_DEBIT_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "externalTrxId": "12345678901234567890123456789012",
  "subscriberId": "tel:94771234567",
  "amount": "1",
  "currency": "LKR"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "statusCode": "S1000",
  "timeStamp": "2012-07-30T12:48:10-0400",
  "statusDetail": "Success",
  "externalTrxId": "12345678901234567890123456789012",
  "internalTrxId": "321"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `externalTrxId` | string | Echo of your ID. Assert it matches what you sent. |
| `internalTrxId` | string | Payment gateway transaction ID. Persist it — support and reconciliation use this. |
| `referenceId` | string | 8-digit number for the payment request, where an external charging menu is involved. |
| `timeStamp` | string | ISO-8601 date/time of the transaction. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1308` | client | Error during the charging operation |
| `E1328` | configuration | Charging operation not allowed. Please check the NCS configuration. |
| `E1329` | configuration | Charging amount too high. Please check the NCS configuration. |
| `E1330` | configuration | Charging amount too low. Please check the NCS configuration. |
| `E1336` | configuration | No matching service code found for the charging amount |
| `E1337` | user-state | Subscriber authentication by charging gateway failed |
| `E1370` | client | Invalid reservation Id |
| `E1371` | configuration | App does not accept payments from the given Payment Instrument |
| `E1372` | user-state | Default payment instrument for the user not found |
| `E1373` | user-state | Invalid payer account |
| `E1376` | client | Unknown charging error → Escalate to support with the externalTrxId. |
| `E1378` | user-state | Insufficient balance → Tell the user; retry later, not immediately. |
| `E1379` | success | Transaction has already completed → Your idempotency key worked. Treat as success — do NOT charge again. **Treat this as success.** |
| `E1380` | client | Transaction currency not supported |
| `E1382` | user-state | Payment Instrument is not allowed to perform transactions |
| `E1404` | client | Charging Failed |
| `E1405` | user-state | Charging Authorization Timed out → The user did not confirm in time. |
| `E1406` | user-state | Charging Authorization Rejected → The user declined. Never retry. |
| `E1605` | client | Invalid charging request |
| `E1606` | client | Invalid charging amount |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- The amount must be pre-agreed and disclosed to the user before they subscribe.
- Persist externalTrxId before the HTTP call, then update the row from the response.
- Never retry with a fresh externalTrxId — a timeout does not mean the charge failed.
- E1379 (already completed) is success. E1406 (user rejected) must never be retried.
- Amount and currency come from server-side config, never from client input.

---

## CaaS Query Balance

Query a subscriber's remaining chargeable balance.

| | |
|---|---|
| **Endpoint** | `POST https://api.ideamart.io/caas/balance/query` |
| **Environment variable** | `IDEAMART_CAAS_BALANCE_URL` |
| **Content type** | `application/json` |
| **Full guide** | [05-caas.md](05-caas.md) |

> **Needs provisioning:** Enable Query Balance Requests. Without it the call fails no matter how
> correct the payload is.

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID generated when provisioning. |
| `password` | string | **Required** | Password authenticating the application. |
| `subscriberId` | string | **Required** | MSISDN or username of the subscriber being queried. The official sample omits the tel: prefix here, unlike every other service; send it tel:-prefixed for consistency — that is what works in practice. |
| `accountId` | string | Optional | Account of the payment instrument. Single value per request. |
| `currency` | string | Optional | Must be LKR. |

### Request

```bash
curl -sS -X POST "$IDEAMART_CAAS_BALANCE_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "subscriberId": "tel:94771234567",
  "accountId": "12345",
  "currency": "LKR"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

```json
{
  "chargeableBalance": "300.0",
  "statusCode": "S1000",
  "statusDetail": "Success",
  "accountStatus": "Active",
  "accountType": "Pre Paid"
}
```

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `chargeableBalance` | string | Remaining balance (prepaid) or credit limit minus outstanding bill (postpaid). A string — parse as decimal. |
| `accountType` | string | Pre Paid / Post Paid. |
| `accountStatus` | string | Account status. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Requires the Enable Query Balance Requests toggle in CaaS provisioning.
- Advisory only — the balance can change before the debit lands. Always handle E1378 on the debit anyway.
- chargeableBalance is a string — parse as decimal, never compare a float for equality.

---

## LBS Get Location

Return a subscriber's network-derived location. Works on feature phones; accuracy in hundreds of metres.

| | |
|---|---|
| **Endpoint** | `POST https://api.dialog.lk/lbs/locate` |
| **Environment variable** | `IDEAMART_LBS_URL` |
| **Content type** | `application/json` |
| **Full guide** | [06-lbs-ivr.md](06-lbs-ivr.md) |

### Request parameters

| Parameter | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Required** | Application ID from provisioning. |
| `password` | string | **Required** | Password from provisioning. |
| `subscriberId` | string | **Required** | MSISDN whose location is requested. One subscriber per request. May be masked. |
| `serviceType` | enum | **Required** | MLP service type. Only IMMEDIATE is currently supported. One of `IMMEDIATE`. |
| `version` | string | Optional | API version (1.0, 2.0). |
| `responseTime` | enum | Optional | Accepted delay. Capped by provisioning — you may request your level or weaker, never stronger. One of `NO_DELAY`, `LOW_DELAY`, `DELAY_TOLERANCE`. |
| `horizontalAccuracy` | enum | Optional | Required accuracy in metres. 100 is the strictest and highest precedence. One of `100`, `500`, `1000`, `1500`. |
| `freshness` | enum | Optional | Required freshness. HIGH_LOW is the highest precedence. One of `HIGH_LOW`, `LOW_HIGH`, `HIGH`, `LOW`. |

### Request

```bash
curl -sS -X POST "$IDEAMART_LBS_URL" \
  -H 'Content-Type: application/json' \
  --max-time 15 \
  -d @- <<REQUEST
{
  "applicationId": "$IDEAMART_APP_ID",
  "password": "$IDEAMART_PASSWORD",
  "subscriberId": "tel:94771234567",
  "serviceType": "IMMEDIATE"
}
REQUEST
```

### Response

HTTP 200. Success is `statusCode: "S1000"` — nothing else.

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

### Response fields

| Field | Type | Meaning |
|---|---|---|
| `statusCode` | string | S1000 on success. |
| `statusDetail` | string | Human-readable outcome. |
| `messageId` | string | Uniquely identifies the request within the SDP. Always present. |
| `latitude` | string | Latitude. Present on success only. |
| `longitude` | string | Longitude. Present on success only. |
| `freshness` | string | Actual age of the fix, in minutes. |
| `horizontalAccuracy` | string | Actual accuracy radius, in metres. |
| `subscriberState` | boolean | Handset power state. true = on. |
| `timeStamp` | string | Transaction date/time. Present on success only. |

### Status codes for this endpoint

| Code | Class | Meaning |
|---|---|---|
| `S1000` | success | Success |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list → Run curl -4 https://myip.ideamart.io on the calling server and add that IP to Allowed Host Addresses. |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. → Check IDEAMART_APP_ID and IDEAMART_PASSWORD, and that the app is active. |
| `E1309` | configuration | Requested service is not allowed for this Application → That API was not provisioned for this app. |
| `E1367` | client | Request QoS not supported → LBS — you requested a QoS level above what the app was provisioned for. |
| `E1368` | client | Requested ServiceType not supported |

`configuration` fix the portal, not the code — the integration is down, not one request · `client` fix the payload or the user's input · `user-state` the user is not eligible right now; tell them, do not loop · `transient` retry with capped exponential backoff. Full table: [08-status-codes.md](08-status-codes.md).

### Rules

- Uses the api.dialog.lk host, not api.ideamart.io.
- Omit the QoS fields unless you know your provisioned level — requesting above it fails with E1367.
- Coordinates are strings and absent on failure. Sanity-check against Sri Lanka (lat ~6-10, lon ~79-82) before use.
- horizontalAccuracy is a radius — treat the position as a circle, never a point.
- Requires explicit, purpose-specific consent. Consent to receive SMS is not consent to be located.

---

# Inbound callbacks — Ideamart calls you

---

## MO SMS Receive

Fires when a subscriber texts your shortcode with your keyword.

| | |
|---|---|
| **Direction** | Ideamart → you. There is nothing to call. |
| **Your route** | `POST <your-host>/api/ideamart/sms/mo` (the path is yours; register it in the portal) |
| **Configured in** | SMS API settings |
| **Deduplicate on** | `requestId` |
| **Full guide** | [02-sms.md](02-sms.md) |

### Payload fields

| Field | Type | | Definition |
|---|---|---|---|
| `version` | string | **Always sent** | API version. |
| `applicationId` | string | **Always sent** | Your application ID — verify it matches. |
| `sourceAddress` | string | **Always sent** | Sender address, masked if masking is enabled. |
| `message` | string | **Always sent** | Message as sent by the user, including the keyword. |
| `requestId` | string | **Always sent** | Unique request identifier within Ideamart. |
| `encoding` | enum | **Always sent** | 0 Text / 240 Flash / 245 Binary (hex-encoded). One of `0`, `240`, `245`. |

### What arrives

```json
{
  "message": "my testing message",
  "sourceAddress": "tel:94771234567",
  "requestId": "22607072011552911",
  "encoding": "0",
  "applicationId": "APP_000001",
  "version": "1.0"
}
```

### What you must respond

HTTP 200, immediately, before doing any work:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success"
}
```

### Replay it against your own handler

```bash
curl -sS -X POST "http://localhost:3000/api/ideamart/sms/mo" \
  -H 'Content-Type: application/json' \
  -d @- <<'PAYLOAD'
{
  "message": "my testing message",
  "sourceAddress": "tel:94771234567",
  "requestId": "22607072011552911",
  "encoding": "0",
  "applicationId": "APP_000001",
  "version": "1.0"
}
PAYLOAD
```

### Rules

- Recognise STOP / UNSUB / OFF and honour them by calling Unregister.
- Do not perform a destructive or chargeable action on the content of one MO SMS alone.

---

## SMS Delivery Status Report

Final delivery state of an MT SMS sent with deliveryStatusRequest 1.

| | |
|---|---|
| **Direction** | Ideamart → you. There is nothing to call. |
| **Your route** | `POST <your-host>/api/ideamart/sms/dlr` (the path is yours; register it in the portal) |
| **Configured in** | SMS API settings |
| **Deduplicate on** | `requestId + deliveryStatus` |
| **Full guide** | [02-sms.md](02-sms.md) |

### Payload fields

| Field | Type | | Definition |
|---|---|---|---|
| `destinationAddress` | string | **Always sent** | Subscriber address. |
| `timeStamp` | string | **Always sent** | Time of the delivery event. Arrives as 10 digits (yyMMddHHmm) or 14 (yyyyMMddHHmmss) — parse on length. |
| `requestId` | string | **Always sent** | Ties the report to the original send. |
| `deliveryStatus` | enum | **Always sent** | Ideamart uses the long forms; the SMPP gateway uses the abbreviated ones. Accept both. One of `DELIVERED`, `EXPIRED`, `DELETED`, `UNDELIVERABLE`, `ACCEPTED`, `UNKNOWN`, `REJECTED`, `DELIVRD`, `UNDELIV`, `ACCEPTD`, `REJECTD`. |

### What arrives

```json
{
  "destinationAddress": "tel:94771234567",
  "timeStamp": "20120113082110",
  "requestId": "MSG_000111",
  "deliveryStatus": "DELIVERED"
}
```

### What you must respond

HTTP 200, immediately, before doing any work:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success"
}
```

### Replay it against your own handler

```bash
curl -sS -X POST "http://localhost:3000/api/ideamart/sms/dlr" \
  -H 'Content-Type: application/json' \
  -d @- <<'PAYLOAD'
{
  "destinationAddress": "tel:94771234567",
  "timeStamp": "20120113082110",
  "requestId": "MSG_000111",
  "deliveryStatus": "DELIVERED"
}
PAYLOAD
```

### Rules

- ACCEPTED is not DELIVERED — it only means the network took the message.
- Reports can arrive out of order, late, twice, or never.

---

## USSD Receive

Fires when a subscriber dials your code or presses a key.

| | |
|---|---|
| **Direction** | Ideamart → you. There is nothing to call. |
| **Your route** | `POST <your-host>/api/ideamart/ussd` (the path is yours; register it in the portal) |
| **Configured in** | USSD API settings |
| **Deduplicate on** | `requestId` |
| **Full guide** | [03-ussd.md](03-ussd.md) |

### Payload fields

| Field | Type | | Definition |
|---|---|---|---|
| `version` | string | **Always sent** | API version. |
| `applicationId` | string | **Always sent** | Your application ID. |
| `sessionId` | string | **Always sent** | Session identifier — echo this back on every send. |
| `ussdOperation` | enum | **Always sent** | mo-init starts a session, mo-cont is subsequent input. One of `mo-init`, `mo-cont`. |
| `sourceAddress` | string | **Always sent** | Sender address, possibly masked. |
| `vlrAddress` | string | Optional | VLR address of the sender. |
| `message` | string | **Always sent** | What the user dialled or typed. |
| `encoding` | string | **Always sent** | 440 = plain ASCII. |
| `requestId` | string | **Always sent** | Unique request identifier within Ideamart. |

### What arrives

```json
{
  "message": "*141#",
  "ussdOperation": "mo-init",
  "requestId": "1330933229901",
  "sessionId": "1330929317043",
  "encoding": "440",
  "sourceAddress": "tel:94771234567",
  "applicationId": "APP_000001",
  "version": "1.0"
}
```

### What you must respond

HTTP 200, immediately, before doing any work:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success"
}
```

### Replay it against your own handler

```bash
curl -sS -X POST "http://localhost:3000/api/ideamart/ussd" \
  -H 'Content-Type: application/json' \
  -d @- <<'PAYLOAD'
{
  "message": "*141#",
  "ussdOperation": "mo-init",
  "requestId": "1330933229901",
  "sessionId": "1330929317043",
  "encoding": "440",
  "sourceAddress": "tel:94771234567",
  "applicationId": "APP_000001",
  "version": "1.0"
}
PAYLOAD
```

### Rules

- The response body is only an acknowledgement — the screen the user sees comes from a separate POST /ussd/send.
- Sessions time out in seconds. Acknowledge before doing any work.

---

## Subscription Notification

Fires whenever a subscription changes, including changes you did not initiate.

| | |
|---|---|
| **Direction** | Ideamart → you. There is nothing to call. |
| **Your route** | `POST <your-host>/api/ideamart/subscription/notification` (the path is yours; register it in the portal) |
| **Configured in** | Subscription API settings |
| **Deduplicate on** | `subscriberId + status + timeStamp` |
| **Full guide** | [04-subscription.md](04-subscription.md) |

### Payload fields

| Field | Type | | Definition |
|---|---|---|---|
| `applicationId` | string | **Always sent** | Your application ID. |
| `subscriberId` | string | **Always sent** | Subscriber address, possibly masked. |
| `status` | enum | **Always sent** | New subscription state. One of `REGISTERED`, `UNREGISTERED`. |
| `frequency` | string | Optional | Charging frequency for the subscription, e.g. Monthly. |
| `version` | string | **Always sent** | API version. |
| `timeStamp` | string | **Always sent** | When the change happened. |

### What arrives

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

### What you must respond

HTTP 200, immediately, before doing any work:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success"
}
```

### Replay it against your own handler

```bash
curl -sS -X POST "http://localhost:3000/api/ideamart/subscription/notification" \
  -H 'Content-Type: application/json' \
  -d @- <<'PAYLOAD'
{
  "applicationId": "APP_001807",
  "frequency": "Monthly",
  "status": "REGISTERED",
  "subscriberId": "tel:94771234567",
  "version": "1.0",
  "timeStamp": "20130402025896"
}
PAYLOAD
```

### Rules

- This is the authoritative source of subscription state — consume it and keep a local mirror instead of polling getStatus.

---

## Charging Notification

Reports the outcome of every executed charging request. This is the reconciliation channel for charges left unresolved after a timeout.

| | |
|---|---|
| **Direction** | Ideamart → you. There is nothing to call. |
| **Your route** | `POST <your-host>/api/ideamart/charging/notification` (the path is yours; register it in the portal) |
| **Configured in** | CaaS Charging Notification URL |
| **Deduplicate on** | `externalTrxId + statusCode` |
| **Full guide** | [05-caas.md](05-caas.md) |

### Payload fields

| Field | Type | | Definition |
|---|---|---|---|
| `externalTrxId` | string | **Always sent** | The idempotency key you sent on the debit. Match on this to find the transaction in your ledger. |
| `internalTrxId` | string | **Always sent** | Platform transaction identifier. Quote it to support. |
| `subscriberId` | string | Optional | The charged subscriber, in the same form you sent. |
| `amount` | string | Optional | Amount charged. Parse into a decimal type. |
| `currency` | string | Optional | LKR. |
| `statusCode` | string | **Always sent** | Final outcome of the charge. S1000 settles the transaction; E1378 and friends fail it. |
| `statusDetail` | string | **Always sent** | Human-readable outcome. |
| `timeStamp` | string | Optional | When the charge reached its final state. |

### What arrives

```json
{
  "externalTrxId": "d41d8cd98f00b204e9800998ecf8427e",
  "internalTrxId": "PAY_00019283",
  "subscriberId": "tel:94771234567",
  "amount": "6.00",
  "currency": "LKR",
  "statusCode": "S1000",
  "statusDetail": "Success",
  "timeStamp": "2026-03-14T09:21:44.000+0530"
}
```

### What you must respond

HTTP 200, immediately, before doing any work:

```json
{
  "statusCode": "S1000",
  "statusDetail": "Success"
}
```

### Replay it against your own handler

```bash
curl -sS -X POST "http://localhost:3000/api/ideamart/charging/notification" \
  -H 'Content-Type: application/json' \
  -d @- <<'PAYLOAD'
{
  "externalTrxId": "d41d8cd98f00b204e9800998ecf8427e",
  "internalTrxId": "PAY_00019283",
  "subscriberId": "tel:94771234567",
  "amount": "6.00",
  "currency": "LKR",
  "statusCode": "S1000",
  "statusDetail": "Success",
  "timeStamp": "2026-03-14T09:21:44.000+0530"
}
PAYLOAD
```

### Rules

- Write the handler against these fields — they mirror the Direct Debit response, which is what the platform reports back.
- Log the raw body on the first Limited Production charge and widen the handler if your account sends extra fields. Ignore unknown fields rather than rejecting the payload.
- Reconcile by externalTrxId against your own ledger: this is how a charge that timed out gets its final answer.
- Deduplicate on externalTrxId + statusCode. A duplicate that double-counts revenue is a real bug.
- Acknowledge with S1000 before doing the reconciliation work.

---

## What a curl does not show

Every command above is one HTTPS POST, and that part ports to any language in a few lines. The
difference between a working call and a production integration is what surrounds it — none of
which is visible in a shell command:

| | Why the curl hides it |
|---|---|
| **Credentials from the environment, injected once** | A shell export becomes a config module that validates at startup and fails loudly. One place reads it; no call site passes credentials as arguments. |
| **`statusCode` branching** | You read the JSON yourself here. Code that checks `res.ok`, `raise_for_status()` or `EnsureSuccessStatusCode()` reports every Ideamart failure as a success. |
| **Benign codes** | `E1351` on register, `E1356` on unregister and `E1379` on debit all mean the desired state already holds. They are successes, and only your code can know that. |
| **Idempotency** | `externalTrxId` has to be generated, persisted before the call, and reused unchanged on retry. A shell loop cannot do this; a ledger row can. |
| **Timeouts and retries** | `--max-time 15` becomes an explicit client timeout, with backoff on transient codes only and no automatic retry at all on a debit. |
| **`tel:` normalisation** | Typed by hand here; in code it is one function at the boundary, never a concatenation at a call site. |
| **Acknowledge-first callbacks** | The replay commands return instantly. A real handler must respond `S1000` and then work out of band — USSD sessions time out in seconds. |

Those seven, plus a shared USSD session store, are the whole specification. They are written out
language-neutrally in [11-any-stack.md](11-any-stack.md), with an acceptance checklist for a
port. [templates/](../templates/README.md) shows the same seven already built in TypeScript/Node,
Python, Java, Go, PHP and C# — worked examples to read for shape, not output to paste.

## Related

| | |
|---|---|
| Machine-readable form of this page | [`catalog/ideamart-api.json`](../catalog/ideamart-api.json) |
| Build a request with your own values | `node tools/ideamart.mjs curl <id> key=value …` |
| Check a payload before sending it | `node tools/ideamart.mjs validate <id> '<json>'` |
| Decode a status code you received | `node tools/ideamart.mjs code <statusCode>` |
| Smoke-test the outbound path | [`scripts/smoke-test.sh`](../scripts/smoke-test.sh) (or `smoke-test.ps1`) |
| Test all five callback handlers | [`scripts/test-callbacks.sh`](../scripts/test-callbacks.sh) |
| Every status code, classified | [08-status-codes.md](08-status-codes.md) |
