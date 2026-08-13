# Status Codes

## The single most important rule

**Ideamart returns HTTP 200 for application-level failures.** The real outcome is the
`statusCode` field in the response body.

```
# WRONG — reports failures as successes
response = http_post(url, body)
if response.ok: return "sent"

# RIGHT
response = http_post(url, body)
data = parse_json(response.body)
if data.statusCode != "S1000":
    raise IdeamartError(data.statusCode, data.statusDetail)
```

Every stack spells the wrong version differently — `res.ok`, `raise_for_status()`,
`EnsureSuccessStatusCode()`, `response.IsSuccessStatusCode`, Guzzle's `http_errors`,
`resp.StatusCode == 200`. All of them are the same bug.

Every response carries `statusCode` and `statusDetail`. Codes starting `S` are success;
codes starting `E` are errors.

| Prefix | Meaning |
|---|---|
| `S1000` | Success |
| `E13xx` | Application, authentication, routing, delivery, charging errors |
| `E14xx` | Card / NFC / charging authorisation errors |
| `E16xx` | Platform-side system errors |
| `E18xx` | OTP and unsupported-operation errors |

---

## Handling classes

Map codes to behaviour, not to strings. Four classes drive four different actions:

| Class | Retry? | What it means |
|---|---|---|
| **Configuration** | **Never** | Your provisioning or credentials are wrong. Code changes will not help. Fix the portal. |
| **Client** | **Never** | Your payload is wrong, or the user gave bad input. Fix the request or prompt the user. |
| **User state** | **Only after user action** | The user is not eligible right now. Communicate, do not retry in a loop. |
| **Transient** | **Yes, backoff** | Platform-side. Exponential backoff with jitter, capped attempts, then dead-letter. |

Every published code carries its class in the [complete list](#complete-official-error-code-list)
below — build your sets from that column, not from a remembered range. `E1308`, for instance,
sits among configuration-class neighbours but is client-class.

Special cases that look like errors but are not:

- **`E1351` "User already registered"** on Register → the desired state already holds. Success.
- **`E1356` "User not registered"** on Unregister → the desired state already holds. Success.
- **`E1379` "Transaction has already completed"** on a debit retry → your idempotency key
  worked. Success. Do **not** charge again.

---

## Codes you will actually hit, and what to do

| Code | Meaning | Action |
|---|---|---|
| `S1000` | Success | Proceed |
| `E1303` | **Source IP not in allowed-host-address list** | Run `curl -4 https://myip.ideamart.io` on the calling server; add that IP in the portal |
| `E1309` | Requested service is not allowed for this application | The API was not provisioned. Portal fix, not a code fix. |
| `E1313` | **Authentication failure** — no active application, no active SP, or wrong password | Check `IDEAMART_APP_ID` / `IDEAMART_PASSWORD`; check the app is active |
| `E1317` | MSISDN is in an invalid state (blocked, or wrong digit length) | Validate the number; do not retry |
| `E1325` | Format of the address is invalid | Missing `tel:` prefix, or a `+`/space slipped in |
| `E1331` | Invalid/unauthorised source address | `sourceAddress` is not a provisioned alias |
| `E1334` / `E1335` | Message too long (normal / advertisement) | Shorten or split |
| `E1351` | User already registered | Treat as success on Register |
| `E1356` | User not registered | Treat as success on Unregister; on send, stop messaging them |
| `E1367` | Requested QoS not supported | LBS — you asked above your provisioned level |
| `E1378` | **Insufficient balance** | Tell the user; retry later, not immediately |
| `E1379` | Transaction already completed | Treat as success |
| `E1850`–`E1853` | OTP invalid / expired / attempts exceeded | Prompt the user; enforce the 3-attempt, 60-minute limits yourself too |

---

## Complete official error code list

Reproduced from <https://docs.ideamart.io/developer-docs/response-codes/>. `{0}` is a
placeholder the platform fills in. The **Class** column is the one to build your error handling
from: it maps each code to one of the four behaviours above, and it is the same classification
`node tools/ideamart.mjs code <statusCode>` returns and
[`catalog/ideamart-api.json`](../catalog/ideamart-api.json) stores.

| Code | Class | Description |
|---|---|---|
| `E1301` | configuration | Requested ApplicationID is not allowed within the System |
| `E1302` | configuration | Requested SP is not allowed within the System |
| `E1303` | configuration | IP address, which the request originates from, is not listed within the allowed-host-address list |
| `E1304` | configuration | Requested Application is not found within the System |
| `E1305` | configuration | Requested ApplicationID is invalid |
| `E1306` | configuration | Routing Key (shortcode/keyword) for the NCS service is invalid |
| `E1307` | configuration | Requested SP is not found within the System |
| `E1308` | client | Error during the charging operation |
| `E1309` | configuration | Requested service is not allowed for this Application |
| `E1310` | configuration | MO flow is not allowed for this Application |
| `E1311` | configuration | MT flow is not allowed for this Application |
| `E1312` | client | Invalid request |
| `E1313` | configuration | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. |
| `E1315` | configuration | Requested NCS service is not available |
| `E1316` | transient | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1317` | user-state | MSISDN in the request is in an invalid state (may be blocked, or have an invalid number of digits) |
| `E1318` | transient | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1319` | transient | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1322` | configuration | Requested sender is not allowed |
| `E1323` | configuration | Requested recipients not allowed |
| `E1324` | configuration | Subscription via HTTP is not allowed |
| `E1325` | client | Format of the address is invalid |
| `E1326` | user-state | Sorry, your SMS sent to {0} application could not be processed. Please check if you have sufficient balance and try again. |
| `E1327` | configuration | App id not allowed in pgw |
| `E1328` | configuration | Charging operation not allowed. Please check the NCS configuration. |
| `E1329` | configuration | Charging amount too high. Please check the NCS configuration. |
| `E1330` | configuration | Charging amount too low. Please check the NCS configuration. |
| `E1331` | configuration | Sorry, invalid/unauthorized source address. Please check the availability of default sender address or aliases for SMS-MT in {0} application. |
| `E1332` | transient | Delivery failed |
| `E1333` | user-state | Message contains suspected abusive content, or subscriber base is larger than the limit; will be stored for admin approval |
| `E1334` | client | Message length is too long. Maximum message length is {0} |
| `E1335` | client | Message length is too long. Maximum message length for advertisement messages is {0} |
| `E1336` | configuration | No matching service code found for the charging amount |
| `E1337` | user-state | Subscriber authentication by charging gateway failed |
| `E1340` | client | Invalid request - {0} |
| `E1341` | transient | Delivery failed. Errors occurred while sending the request for the intended destinations |
| `E1342` | user-state | Sorry, your phone number is blacklisted to use this application {0} |
| `E1343` | user-state | Non-whitelisted mobile number accessing services of application {0} |
| `E1344` | user-state | Sorry, your SMS sent to {0} application could not be processed. Please check if you have sufficient balance and try again. |
| `E1351` | user-state | User already registered |
| `E1356` | user-state | User not registered |
| `E1357` | user-state | Sorry, you are unauthorised to use the {0} application. |
| `E1360` | transient | Error response from SDP-SBL |
| `E1361` | client | Message rejected by SDP-SBL |
| `E1362` | client | Invalid request |
| `E1363` | transient | No response / response delayed from SDP-SBL |
| `E1364` | transient | Could not send the message to SDP-SBL |
| `E1365` | user-state | Subscriber is not registered to use this application |
| `E1366` | transient | MT delivery failed |
| `E1367` | client | Request QoS not supported |
| `E1368` | client | Requested ServiceType not supported |
| `E1370` | client | Invalid reservation Id |
| `E1371` | configuration | App does not accept payments from the given Payment Instrument |
| `E1372` | user-state | Default payment instrument for the user not found |
| `E1373` | user-state | Invalid payer account |
| `E1374` | client | Invalid payee account |
| `E1375` | client | Transfer between two different payment instruments is not allowed |
| `E1376` | client | Unknown charging error |
| `E1377` | client | Invalid payment instrument name |
| `E1378` | user-state | Insufficient balance |
| `E1379` | success | Transaction has already completed |
| `E1380` | client | Transaction currency not supported |
| `E1381` | configuration | IP address, which the request originates from, is not allowed to access this service |
| `E1382` | user-state | Payment Instrument is not allowed to perform transactions |
| `E1383` | configuration | USSD network initiated flow not allowed |
| `E1384` | configuration | International SMS sending is disabled |
| `E1387` | configuration | NCS SLA configured Merchant ID not found in DB |
| `E1400` | transient | Card Management Module Unavailable |
| `E1401` | client | Invalid NFC Token |
| `E1402` | client | NFC Token does not match with request |
| `E1404` | client | Charging Failed |
| `E1405` | user-state | Charging Authorization Timed out |
| `E1406` | user-state | Charging Authorization Rejected |
| `E1600` | transient | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1601` | transient | An unexpected error has occurred |
| `E1602` | transient | Message delivery failed |
| `E1603` | transient | Temporary System Error occurred while delivering your request |
| `E1605` | client | Invalid charging request |
| `E1606` | client | Invalid charging amount |
| `E1825` | client | Unsupported operation |
| `E1830` | user-state | This service is not available for {0} users |
| `E1850` | client | Invalid OTP |
| `E1851` | client | OTP request has expired |
| `E1852` | client | Maximum number of OTP attempts reached |
| `E1853` | client | No active OTP request found for this reference number |

---

## Reference implementation

Whatever your language calls an error — exception, error struct, result variant — it needs the
code, the detail, and two questions answerable from the sets below:

```
TRANSIENT = { E1316, E1318, E1319, E1332, E1341,
              E1360, E1363, E1364, E1600, E1601, E1602, E1603 }

CONFIGURATION = { E1301, E1302, E1303, E1304, E1305, E1306, E1307,
                  E1309, E1310, E1311, E1313, E1315, E1322, E1323,
                  E1324, E1327, E1328, E1329, E1336, E1371, E1381,
                  E1383, E1387 }

# Codes that mean "the outcome you wanted already holds".
BENIGN = { register: E1351, unregister: E1356, debit: E1379 }

error IdeamartError(statusCode, statusDetail, service):
    retryable       = statusCode in TRANSIENT
    isConfiguration = statusCode in CONFIGURATION
```

These sets are also machine-readable in
[`catalog/ideamart-api.json`](../catalog/ideamart-api.json) under `statusCodes` (each code
carries its `class`), so you can generate them rather than retyping them.

Working versions: [templates/](../templates/README.md) — TypeScript, Python, Java, Go, PHP and
C# all express exactly this.

Alerting rule of thumb: any **configuration**-class code in production is a page — the whole
integration is down, not one request. Transient codes belong on a rate dashboard.
