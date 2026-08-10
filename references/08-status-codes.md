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

| Class | Codes | Retry? | What it means |
|---|---|---|---|
| **Configuration** | `E1301`–`E1311`, `E1313`, `E1315`, `E1322`–`E1324`, `E1327`–`E1329`, `E1336`, `E1371`, `E1383`, `E1387` | **Never** | Your provisioning or credentials are wrong. Code changes will not help. Fix the portal. |
| **Client** | `E1312`, `E1317`, `E1325`, `E1334`, `E1335`, `E1340`, `E1362`, `E1367`, `E1368`, `E1380`, `E1605`, `E1606`, `E1825`, `E1850`–`E1853` | **Never** | Your payload is wrong, or the user gave bad input. Fix the request or prompt the user. |
| **User state** | `E1330`, `E1342`, `E1343`, `E1351`, `E1356`, `E1357`, `E1365`, `E1372`, `E1373`, `E1378`, `E1382`, `E1406`, `E1830` | **Only after user action** | The user is not eligible right now. Communicate, do not retry in a loop. |
| **Transient** | `E1316`, `E1318`, `E1319`, `E1332`, `E1341`, `E1360`, `E1363`, `E1364`, `E1600`–`E1603` | **Yes, backoff** | Platform-side. Exponential backoff with jitter, capped attempts, then dead-letter. |

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
placeholder the platform fills in.

| Code | Description |
|---|---|
| `E1301` | Requested ApplicationID is not allowed within the System |
| `E1302` | Requested SP is not allowed within the System |
| `E1303` | IP address, which the request originates from, is not listed within the allowed-host-address list |
| `E1304` | Requested Application is not found within the System |
| `E1305` | Requested ApplicationID is invalid |
| `E1306` | Routing Key (shortcode/keyword) for the NCS service is invalid |
| `E1307` | Requested SP is not found within the System |
| `E1308` | Error during the charging operation |
| `E1309` | Requested service is not allowed for this Application |
| `E1310` | MO flow is not allowed for this Application |
| `E1311` | MT flow is not allowed for this Application |
| `E1312` | Invalid request |
| `E1313` | Authentication failure. There is no active application, or no active service provider, or the given password in the request is invalid. |
| `E1315` | Requested NCS service is not available |
| `E1316` | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1317` | MSISDN in the request is in an invalid state (may be blocked, or have an invalid number of digits) |
| `E1318` | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1319` | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1322` | Requested sender is not allowed |
| `E1323` | Requested recipients not allowed |
| `E1324` | Subscription via HTTP is not allowed |
| `E1325` | Format of the address is invalid |
| `E1326` | Sorry, your SMS sent to {0} application could not be processed. Please check if you have sufficient balance and try again. |
| `E1327` | App id not allowed in pgw |
| `E1328` | Charging operation not allowed. Please check the NCS configuration. |
| `E1329` | Charging amount too high. Please check the NCS configuration. |
| `E1330` | Charging amount too low. Please check the NCS configuration. |
| `E1331` | Sorry, invalid/unauthorized source address. Please check the availability of default sender address or aliases for SMS-MT in {0} application. |
| `E1332` | Delivery failed |
| `E1333` | Message contains suspected abusive content, or subscriber base is larger than the limit; will be stored for admin approval |
| `E1334` | Message length is too long. Maximum message length is {0} |
| `E1335` | Message length is too long. Maximum message length for advertisement messages is {0} |
| `E1336` | No matching service code found for the charging amount |
| `E1337` | Subscriber authentication by charging gateway failed |
| `E1340` | Invalid request - {0} |
| `E1341` | Delivery failed. Errors occurred while sending the request for the intended destinations |
| `E1342` | Sorry, your phone number is blacklisted to use this application {0} |
| `E1343` | Non-whitelisted mobile number accessing services of application {0} |
| `E1344` | Sorry, your SMS sent to {0} application could not be processed. Please check if you have sufficient balance and try again. |
| `E1351` | User already registered |
| `E1356` | User not registered |
| `E1357` | Sorry, you are unauthorised to use the {0} application. |
| `E1360` | Error response from SDP-SBL |
| `E1361` | Message rejected by SDP-SBL |
| `E1362` | Invalid request |
| `E1363` | No response / response delayed from SDP-SBL |
| `E1364` | Could not send the message to SDP-SBL |
| `E1365` | Subscriber is not registered to use this application |
| `E1366` | MT delivery failed |
| `E1367` | Request QoS not supported |
| `E1368` | Requested ServiceType not supported |
| `E1370` | Invalid reservation Id |
| `E1371` | App does not accept payments from the given Payment Instrument |
| `E1372` | Default payment instrument for the user not found |
| `E1373` | Invalid payer account |
| `E1374` | Invalid payee account |
| `E1375` | Transfer between two different payment instruments is not allowed |
| `E1376` | Unknown charging error |
| `E1377` | Invalid payment instrument name |
| `E1378` | Insufficient balance |
| `E1379` | Transaction has already completed |
| `E1380` | Transaction currency not supported |
| `E1381` | IP address, which the request originates from, is not allowed to access this service |
| `E1382` | Payment Instrument is not allowed to perform transactions |
| `E1383` | USSD network initiated flow not allowed |
| `E1384` | International SMS sending is disabled |
| `E1387` | NCS SLA configured Merchant ID not found in DB |
| `E1400` | Card Management Module Unavailable |
| `E1401` | Invalid NFC Token |
| `E1402` | NFC Token does not match with request |
| `E1404` | Charging Failed |
| `E1405` | Charging Authorization Timed out |
| `E1406` | Charging Authorization Rejected |
| `E1600` | Sorry, the {0} application is temporarily unavailable. Please try again later. |
| `E1601` | An unexpected error has occurred |
| `E1602` | Message delivery failed |
| `E1603` | Temporary System Error occurred while delivering your request |
| `E1605` | Invalid charging request |
| `E1606` | Invalid charging amount |
| `E1825` | Unsupported operation |
| `E1830` | This service is not available for {0} users |
| `E1850` | Invalid OTP |
| `E1851` | OTP request has expired |
| `E1852` | Maximum number of OTP attempts reached |
| `E1853` | No active OTP request found for this reference number |

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
