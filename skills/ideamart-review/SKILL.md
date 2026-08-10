---
name: ideamart-review
description: Review Ideamart integration code for the mistakes that cost money, leak credentials, or get an application suspended. Use when asked to review, audit, or check Ideamart code, or before merging a pull request that touches Ideamart.
---

# Review an Ideamart integration

Run `node tools/ideamart.mjs practices` first, then check each one against the code. Report
findings with `file:line`, most severe first. Do not report style opinions — only these.

## Critical — stop the merge

| Check | How it looks in code |
|---|---|
| Hardcoded credentials | An `APP_` id or a 32-hex-character string in source, tests, fixtures, a config file (`application.yml`, `appsettings.json`, `settings.py`) or git history |
| Credentials in a client bundle | A browser-exposed prefix (`NEXT_PUBLIC_`/`VITE_`/`REACT_APP_`/`PUBLIC_`/`EXPO_PUBLIC_`) on an Ideamart variable, a config endpoint that serves them, or any Ideamart call in browser or mobile code |
| HTTP status treated as success | `res.ok`, `res.status === 200`, `raise_for_status()`, `EnsureSuccessStatusCode()`, `response.IsSuccessStatusCode`, Guzzle `http_errors` — with no `statusCode` check |
| Non-idempotent charging | `externalTrxId` generated inside a retry, or after the API call rather than before |
| Debit retried with a new ID | Any generic retry wrapper (Polly, tenacity, Spring Retry, an interceptor) around the debit call |
| Charging without consent evidence | No stored record of who agreed, when, and to what amount |
| Disabled TLS verification | `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `verify=False`, `InsecureSkipVerify: true`, `CURLOPT_SSL_VERIFYPEER => false`, a trust-all `TrustManager`, or a certificate callback returning `true` — outside a gated dev path |

## High

- `destinationAddresses` passed as a string rather than an array.
- `E1351` / `E1356` / `E1379` treated as failures — all three mean the desired state holds.
- `tel:` concatenated inline instead of through one normalising helper.
- `subscriberId` parsed, trimmed, or assumed to be a phone number.
- Callback handler doing work before returning `S1000` — including an inline `await`/blocking
  call where the stack has a real background mechanism.
- Callback handler with no deduplication key.
- Callback handler that trusts the body, or has no schema validation.
- A callback returning non-200 on a malformed payload, which just triggers redelivery.
- `tel:all` reachable from an ordinary code path.
- Secrets, OTPs, `referenceNo` or unmasked `subscriberId` in logs.

## Medium

- No explicit timeout on outbound calls.
- Retries on definitive `E13xx` codes, or retries without backoff.
- USSD `sessionId` generated locally instead of echoed from the platform.
- USSD flow ending in `mt-cont` instead of `mt-fin`.
- An in-process USSD session store (`Map`, `dict`, `HashMap`, package-level `map`, `MemoryCache`)
  where more than one instance or worker runs.
- `getStatus` polled per request instead of mirroring subscription notifications.
- Money held in a binary float (`number`, `float`, `double`) rather than a decimal type.
- A new runtime or sidecar introduced purely to call Ideamart from a non-JS project.
- Amount or currency taken from client input.

## Output

For each finding give the rule, the evidence, and the specific fix. Finish with a plain verdict
on whether this is safe to put in front of real subscribers who can be charged real money.
