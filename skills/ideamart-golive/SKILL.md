---
name: ideamart-golive
description: Run the Ideamart pre-production checklist before requesting full production approval — credentials, network, correctness, callbacks, charging, consent, privacy, operations and testing. Use before going live, or when asked whether an Ideamart integration is production-ready.
---

# Ideamart go-live check

```bash
node tools/ideamart.mjs checklist          # the full list
node tools/ideamart.mjs checklist --json   # machine-readable, for automation
```

Work through every item against the actual project. For each, state **PASS**, **FAIL** or
**CANNOT VERIFY**, with the evidence — a file path, a config value, a test run. Never mark
PASS on the assumption that something is probably fine; on this platform the cost of a wrong
assumption is charged to a real person's phone bill.

## The nine sections

1. **Credentials and configuration** — nothing in source or git history, secrets in the host's
   secret manager, startup validation that fails loudly, separate dev and production
   credentials, secret scanning in CI.
2. **Network** — production egress IP confirmed *on the production server* and whitelisted,
   callback URLs stable and publicly reachable over HTTPS with a complete chain, TLS
   verification on.
3. **Correctness** — branch on `statusCode`; `E1351`/`E1356`/`E1379` handled as success;
   `tel:` normalised in one helper; `destinationAddresses` an array; USSD `sessionId` echoed
   and flows terminated with `mt-fin`; explicit timeouts.
4. **Callbacks** — all five implemented, acknowledging before doing work, idempotent with a
   dedupe key, schema-validated, and tested with a duplicate payload.
5. **Charging** — `externalTrxId` persisted before the call, retries reuse it, `E1406` never
   retried, timeouts resolved by reconciliation, decimal money, a reconciliation job.
6. **Consent and compliance** — opt-in recorded with evidence, the charge disclosed before
   subscribing, opt-out available in every channel and honoured immediately including queued
   messages, `tel:all` behind a deliberate path.
7. **Privacy** — masking enabled where the real MSISDN is not needed, `subscriberId` masked in
   logs, message bodies not logged, retention defined and enforced.
8. **Operations** — identifiers logged on every operation, alerting on configuration-class
   errors (`E1303`/`E1313`/`E1309`), a TPS/TPD throttle, a dead-letter queue, a runbook, and a
   named owner who can log in to rotate credentials.
9. **Testing** — end-to-end against Limited Production with whitelisted numbers, failure paths
   included (`E1313`, `E1303`, `E1378`, timeout), and tested **from the production egress IP**.

## Verdict

Finish with the FAIL items ordered by risk, and a plain statement: is this safe to put in
front of real subscribers who can be charged real money?

Full list: `references/10-production-checklist.md`.
