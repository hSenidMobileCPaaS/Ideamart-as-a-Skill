# CaaS — Charging as a Service

CaaS charges money from an end user's mobile account — prepaid balance is reduced, postpaid is
added to the monthly bill. No cards, no wallet, no cash.

**This API moves real money belonging to real people.** Every rule in this file exists because
breaking it costs someone money.

| Service | Endpoint | Availability |
|---|---|---|
| **Direct Debit** | `POST /caas/direct/debit` | All operators |
| **Query Balance** | `POST /caas/balance/query` | Requires **Enable Query Balance Requests** in CaaS provisioning |
| **Charging Notification** | Your callback URL | All |

---

## The five charging rules

1. **The amount must be pre-agreed and disclosed to the user before they subscribe.** Ideamart
   requires a pre-defined specific amount, communicated in advance. Arbitrary or surprise
   amounts are a compliance failure.
2. **`externalTrxId` is your idempotency key.** Generate it once, persist it *before* the HTTP
   call, and reuse the same value for any retry of that same logical charge.
3. **Never retry a debit with a fresh `externalTrxId`.** A timeout does not mean the charge did
   not happen. Retry with the same ID, or reconcile — never re-roll.
4. **Never charge from a request you did not authenticate.** A webhook body, an MO SMS, or a
   USSD keypress is not authorisation on its own.
5. **A charge must be traceable to a user action.** Log who, what, when, how much, which
   `externalTrxId`, and what the user saw before they agreed.

---

## Direct Debit

```
POST /caas/direct/debit
Content-Type: application/json
```

### Request

```json
{
  "applicationId": "APP_000017",
  "password": "…",
  "externalTrxId": "12345678901234567890123456789012",
  "subscriberId": "tel:94771234567",
  "accountId": "123456",
  "paymentInstrument": "MobileAccount",
  "currency": "LKR",
  "amount": "1"
}
```

| Parameter | Description | Type | M/O |
|---|---|---|---|
| `applicationId` | Application ID from provisioning | String | **M** |
| `password` | Password from provisioning | String | **M** |
| `externalTrxId` | **Your** transaction ID, mapping request to response | String | **M** |
| `subscriberId` | MSISDN or hash key of the subscriber to charge | String | **M** |
| `amount` | Amount to charge — sent as a **string** | String | **M** |
| `paymentInstrument` | Account the debit is performed on, e.g. `MobileAccount` | String | O |
| `accountId` | Account of the payment instrument | String | O |
| `currency` | Currency of the amount. `LKR` for Sri Lanka; if not LKR it must be specified. | String | O |

Send the six mandatory fields and nothing else. `paymentInstrument` and `accountId` exist for
applications provisioned against a specific payment instrument; a standard mobile-account debit
omits both.

### Response

```json
{
  "statusCode": "S1000",
  "timeStamp": "2012-07-30T12:48:10-0400",
  "statusDetail": "Success",
  "externalTrxId": "12345678901234567890123456789012",
  "internalTrxId": "321",
  "shortDescription": "short Description",
  "longDescription": "Long Description"
}
```

| Parameter | Description | M/O |
|---|---|---|
| `externalTrxId` | Echo of your ID — **assert it matches what you sent** | M |
| `internalTrxId` | Payment gateway's unique transaction ID. **Persist this** — it is what support and reconciliation use. | M |
| `referenceId` | 8-digit number generated for the payment request, where an external charging menu is involved | O |
| `timeStamp` | ISO-8601 date/time of the transaction | |
| `statusCode` / `statusDetail` | Outcome | M |

### `externalTrxId` rules

- Unique per logical charge, across all time. UUIDv4 or ULID.
- The documented samples are 32 characters — stay at or under that.
- **Persist before you send.** The correct order is: write a `PENDING` charge row → call the
  API → update the row from the response. If you crash between, you can reconcile; if you
  never wrote the row, the money is gone with no record.

### Charging state machine

```
PENDING ──S1000──────────────► CHARGED     (persist internalTrxId)
   │
   ├──E1378 (insufficient) ──► FAILED_FUNDS   (do not retry immediately; tell the user)
   ├──E1308 / E1404 ────────► FAILED          (do not retry blind; investigate)
   ├──E1379 (already done) ─► CHARGED         (a previous attempt succeeded)
   └──timeout / network ────► UNKNOWN         (retry SAME externalTrxId, else reconcile)
```

`E1379` — "Transaction has already completed" — is the platform telling you your idempotency
key worked. Treat it as success, not as an error.

### Charging-related status codes

| Code | Meaning | What to do |
|---|---|---|
| `E1308` | Error during the charging operation | Investigate; do not blind-retry |
| `E1328` | Charging operation not allowed — check NCS configuration | Provisioning fix |
| `E1329` | Charging amount too **high** for configuration | Fix the amount |
| `E1330` | Charging amount too **low** for configuration | Fix the amount |
| `E1336` | No matching service code for the charging amount | Provisioning fix |
| `E1337` | Subscriber authentication by charging gateway failed | User did not confirm |
| `E1370` | Invalid reservation ID | — |
| `E1371` | App does not accept payments from the given payment instrument | Provisioning fix |
| `E1372` | Default payment instrument for the user not found | User-side |
| `E1376` | Unknown charging error | Escalate with `externalTrxId` |
| `E1378` | **Insufficient balance** | Tell the user; retry later, not immediately |
| `E1379` | Transaction has already completed | **Treat as success** |
| `E1380` | Transaction currency not supported | Fix `currency` |
| `E1382` | Payment instrument not allowed to perform transactions | User-side |
| `E1404` | Charging failed | Investigate |
| `E1405` | Charging authorisation timed out | The user did not confirm in time |
| `E1406` | Charging authorisation rejected | The user declined — **do not retry** |
| `E1605` / `E1606` | Invalid charging request / amount | Fix the payload |

Note that administrators may require **end-user authentication for charging** — the user
confirms via SMS or USSD before the debit completes. That is why `E1405` and `E1406` exist,
and why a debit is not instantaneous. Never block a USSD session on it.

---

## Query Balance

Check available balance before attempting a charge. Requires **Enable Query Balance Requests**
to be switched on in your application's CaaS common configuration — otherwise the call fails
regardless of how correct the payload is.

```
POST /caas/balance/query
Content-Type: application/json
```

```json
{
  "applicationId": "APP_000018",
  "password": "…",
  "subscriberId": "94771234567",
  "accountId": "12345",
  "currency": "LKR"
}
```

| Parameter | Description | M/O |
|---|---|---|
| `applicationId` | Application ID | **M** |
| `password` | Password | **M** |
| `subscriberId` | MSISDN or username of the subscriber being queried | **M** |
| `accountId` | Account of the payment instrument — single value per request | O |
| `currency` | Must be `LKR` | O |

```json
{
  "chargeableBalance": "300.0",
  "statusCode": "S1000",
  "statusDetail": "Success",
  "accountStatus": "Active",
  "accountType": "Pre Paid"
}
```

| Parameter | Description | M/O |
|---|---|---|
| `chargeableBalance` | Remaining balance (prepaid) or credit limit minus outstanding bill (postpaid) | M |
| `accountType` | `Pre Paid` / `Post Paid` | M |
| `accountStatus` | Account status | M |
| `statusCode` / `statusDetail` | Outcome | M |

Notes:

- `chargeableBalance` is a **string** — parse as decimal, never as a float you then compare
  for equality. Use a decimal type for money.
- A balance check is **advisory, not a reservation**. The balance can change between the query
  and the debit. Always handle `E1378` on the debit regardless of what the query said.
- Leaving `IDEAMART_CAAS_BALANCE_URL` unset is how you disable this on an application without
  the toggle — the client then refuses the call locally instead of failing on every charge
  attempt.

---

## Charging Notification (inbound)

Configured during provisioning as the **Charging Notification URL**. The platform posts a
report for every executed charging request, giving you a track record independent of your own
response handling.

### Payload

It mirrors the Direct Debit response — the same transaction identifiers, carrying the final
outcome:

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

Read the fields you need, ignore any others, and log the raw body on your first Limited
Production charge so you can widen the handler if your account sends extras. Generate the
handler with `ideamart codegen charging-notification --lang=<language>`, or write it from the
field-by-field payload and replay command in [13-curl-reference.md](13-curl-reference.md).

This is your **reconciliation channel**:

- Use it to resolve every charge your code left in `UNKNOWN` after a timeout.
- Match on `externalTrxId` — the key you generated and persisted before the debit.
- Deduplicate on `externalTrxId` + `statusCode`. A repeat notification for an already-charged
  transaction must not double-count revenue.
- Respond `{"statusCode":"S1000","statusDetail":"Success"}` promptly, as with every callback.

See [07-callbacks.md](07-callbacks.md).

---

## Operational limits

- **Max TPS and TPD are fixed** per operator agreement and shown in the portal. They are not
  usually negotiable. Queue and throttle on your side; do not fire charges in an unbounded loop.
- **Subscription-before-charging** is a provisioning toggle. If enabled, a user must be
  registered before you can charge them — useful for recurring services. Turn it off for
  genuine one-off payments (e-commerce checkout).
- **Recurring vs on-demand:** recurring charges are configured through the subscription's
  frequency; on-demand charging is what direct debit gives you. Do not simulate a recurring
  charge with a cron job hitting direct debit unless that is what you provisioned for.

---

## Money-handling checklist for generated code

- [ ] Amounts use a decimal type, never a binary float
- [ ] `externalTrxId` persisted before the API call
- [ ] Transaction row written before, updated after
- [ ] `E1379` mapped to success
- [ ] `E1406` never retried
- [ ] Timeouts resolved via notification/reconciliation, not by re-charging
- [ ] Every charge traceable to a logged user action and consent record
- [ ] `internalTrxId` stored for support
- [ ] Amount and currency come from server-side config or a server-side price lookup — **never
      from client input**
