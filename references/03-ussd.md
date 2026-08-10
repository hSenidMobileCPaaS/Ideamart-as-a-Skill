# USSD API

USSD gives you an interactive session-based menu that works on **any** handset, including
feature phones, with no app and no data connection. The user dials a code (`*141#`), the
platform opens a session and pushes each keypress to your callback URL; you reply with the
next screen.

| Service | Direction | Where |
|---|---|---|
| **Send** | App → user (a screen) | `POST /ussd/send` |
| **Receive** | User → app (a keypress) | Your USSD callback URL |

---

## The session model — read this before writing any code

A USSD session is short-lived (tens of seconds), stateful, and identified by `sessionId`.
The `ussdOperation` field is the state machine, and **who sets which value matters**:

| Value | Set by | Meaning |
|---|---|---|
| `mo-init` | **Platform** | Subscriber dialled your code — session start |
| `mo-cont` | **Platform** | Subscriber replied within an existing session |
| `mt-init` | **Your app** | *Your app* is starting a session with a user (app-initiated) |
| `mt-cont` | **Your app** | Next screen; keep the session open, expect a reply |
| `mt-fin` | **Your app** | Final screen; **ends the session** |

The normal flow:

```
user dials *141#
   → platform POSTs your callback:  ussdOperation = mo-init,  sessionId = S
   → you POST /ussd/send:           ussdOperation = mt-cont,  sessionId = S   (show menu)
user presses 2
   → platform POSTs your callback:  ussdOperation = mo-cont,  sessionId = S
   → you POST /ussd/send:           ussdOperation = mt-fin,   sessionId = S   (show result, close)
```

Hard rules:

1. **Echo the `sessionId` you were given.** Never generate one for a session the platform
   started. A wrong `sessionId` orphans the session and the user sees nothing.
2. **`mt-fin` closes the session.** Send it for terminal screens. If you keep sending
   `mt-cont` the session hangs until the network times it out — a bad user experience and a
   leaked session in your store.
3. **You must reply fast.** USSD sessions time out in seconds. Do the minimum inline; defer
   anything slow (charging, third-party calls) and tell the user you will SMS them the result.
4. **Session state lives on your side**, keyed by `sessionId`, with a TTL. The platform sends
   you the keypress, not the path the user took to get there.

---

## Send Service

```
POST /ussd/send
Content-Type: application/json
```

### Request

```json
{
  "applicationId": "APP_000001",
  "password": "…",
  "version": "1.0",
  "message": "1. Press One\n2. Press Two\n3. Press Three\n4. Exit",
  "sessionId": "1330929317043",
  "ussdOperation": "mt-cont",
  "destinationAddress": "tel:94771234567",
  "encoding": "440"
}
```

| Parameter | Description | Type | Mandatory |
|---|---|---|---|
| `applicationId` | Application ID from provisioning | String | **Mandatory** |
| `password` | Password from provisioning | String | **Mandatory** |
| `version` | API version | String | Optional — defaults to latest |
| `message` | The screen text sent to the handset | String | **Mandatory** |
| `sessionId` | Unique session number assigned by the USSD gateway; constant for the whole session | String | **Mandatory** |
| `ussdOperation` | `mt-init` / `mt-cont` / `mt-fin` for outbound | Enum (string) | **Mandatory** |
| `destinationAddress` | Subscriber address, `tel:` prefixed; may be a hash key | String | **Mandatory** |
| `encoding` | `440` = plain ASCII | Enum | Optional |

### Response

```json
{
  "statusCode": "S1000",
  "timeStamp": "1203051205",
  "statusDetail": "Success",
  "requestId": "1330929317059",
  "version": "1.0"
}
```

| Parameter | Description |
|---|---|
| `version` | API version |
| `requestId` | Uniquely identifies the request within Ideamart |
| `timeStamp` | Processed timestamp |
| `statusCode` / `statusDetail` | Outcome — check this, not the HTTP status |

`E1383` means network-initiated (`mt-init`) USSD flow is not allowed for your app.

---

## Receive Service

The platform `POST`s to your USSD callback URL.

### What you receive

```json
{
  "message": "*141#",
  "ussdOperation": "mo-init",
  "requestId": "1330933229901",
  "sessionId": "1330929317043",
  "encoding": "440",
  "sourceAddress": "tel:94771234567",
  "vlrAddress": "some vlr address",
  "applicationId": "APP_000001",
  "version": "1.0"
}
```

| Parameter | Description | Mandatory |
|---|---|---|
| `version` | API version | Mandatory |
| `applicationId` | Your application ID | Mandatory |
| `sessionId` | Session identifier — **echo this back** | Mandatory |
| `ussdOperation` | `mo-init` (session start) or `mo-cont` (subsequent input) | Mandatory |
| `sourceAddress` | Sender address, possibly masked | Mandatory |
| `vlrAddress` | VLR address of the sender | Optional |
| `message` | What the user dialled or typed | Mandatory |
| `encoding` | `440` = plain ASCII | Mandatory |
| `requestId` | Unique request identifier within Ideamart | Mandatory |

### What you must respond

```json
{ "statusCode": "S1000", "statusDetail": "Success" }
```

This is only an **acknowledgement** that you received the keypress. The screen the user sees
comes from a *separate* `POST /ussd/send` call. Do not try to return menu text in the
acknowledgement body.

---

## Writing menus that work

USSD screens are tiny and the input is a single keypress. Constraints:

- **~182 characters per screen.** Assume 160 to be safe. Long menus get truncated on real
  handsets, and the user sees nothing telling them why.
- **Plain ASCII only** (`encoding: 440`). No emoji, no Sinhala/Tamil script, no smart quotes,
  no tabs. Sanitise generated text before sending.
- **Number your options `1..9`** and keep them one line each. Always give an explicit exit.
- Keep the tree **shallow** — 2 to 3 levels. Every extra level is another network round-trip
  inside a session that may time out.
- Handle invalid input explicitly: reshow the menu with a short "Invalid option" prefix
  rather than dropping the session.

### Session store requirements

Keyed by `sessionId`, holding at minimum: current node, `sourceAddress`, created-at.

- **TTL of ~2 minutes**, then evict. Sessions that are never closed must not accumulate.
- **Must be shared across instances** if you run more than one process — an in-process store
  (a JS `Map`, a Python `dict`, a Java `HashMap`, a Go `map`, a .NET `MemoryCache`) breaks the
  moment you scale horizontally, add a worker, or deploy. Use Redis or equivalent in production.
- Never store the raw MSISDN longer than the session needs it.

Worked in-memory implementations (fine for development, explicitly not for multi-instance
production) are in [templates/typescript/ussd-session.ts](../templates/typescript/ussd-session.ts)
and [templates/python/ussd_session.py](../templates/python/ussd_session.py); the Java, Go, PHP
and C# callback templates each carry the same store behind an interface, ready to swap for
Redis.

### Worked example

```
mo-init  "*141#"     → mt-cont  "Welcome to Acme\n1. Balance\n2. Top up\n3. Support\n0. Exit"
mo-cont  "1"         → mt-fin   "Your balance is Rs. 300.00"
mo-cont  "3"         → mt-cont  "Support\n1. Call us\n2. SMS us\n0. Back"
mo-cont  "0"         → mt-fin   "Thank you."
mo-cont  "banana"    → mt-cont  "Invalid option\n1. Balance\n2. Top up\n3. Support\n0. Exit"
```

---

## Combining USSD with other services

USSD is frequently the *front door* to another API:

- **USSD → Subscription:** menu option "Subscribe" calls `POST /subscription/send` with
  `action: "1"`. This is a clean consent capture — record the `sessionId` and timestamp as
  your consent evidence.
- **USSD → CaaS:** never charge inline. Acknowledge with `mt-fin` ("Processing, we'll SMS
  you"), then debit asynchronously and SMS the result. A charging call is far slower than a
  USSD session allows.
- **USSD → SMS:** the standard pattern for delivering anything longer than one screen.
