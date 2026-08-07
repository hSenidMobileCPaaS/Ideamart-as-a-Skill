---
name: ideamart
description: Build and integrate Ideamart (Dialog Axiata's Sri Lankan telco platform) services — SMS, USSD, Subscription (register, unregister, status, query base size), OTP, CaaS charging (direct debit, balance query), and LBS. Use whenever the user mentions Ideamart, IdeaPro, api.ideamart.io, MSISDN/`tel:` addressing, shortcode/keyword, USSD menus, subscriber base size, direct carrier billing, mobile-account charging, or telco SMS/USSD in Sri Lanka.
---

# Ideamart

Ideamart is Dialog Axiata's telco platform for Sri Lanka (operators Dialog, Hutch 072/078,
Airtel). It exposes SMS, USSD, subscription lifecycle, mobile-account charging and location
as JSON-over-HTTPS APIs.

## Do this first — do not recall parameter names, query them

```bash
node tools/ideamart.mjs list                 # what exists
node tools/ideamart.mjs show <id>            # exact contract
node tools/ideamart.mjs validate <id> '<json>'
node tools/ideamart.mjs code <statusCode>
```

Full command list: `node tools/ideamart.mjs help`. Add `--json` for machine-readable output.
If you cannot run commands, read `catalog/ideamart-api.json`.

## Five rules that are never negotiable

1. **Credentials come from environment variables.** Never hardcoded, never in a client
   bundle, never logged, never committed. Never `NEXT_PUBLIC_`/`VITE_`/`REACT_APP_`.
2. **Ideamart is called from the backend only.** IP whitelisting is enforced; a client cannot
   satisfy it, and the credentials are a shared secret.
3. **Explicit, recorded consent before any Register or charge**, with the amount and
   frequency disclosed first.
4. **`subscriberId` is opaque** — with masking it is a hash, not a phone number.
5. **Charging is idempotent** on `externalTrxId`, persisted before the call, reused on retry.

## The one thing agents get wrong

**Ideamart returns HTTP 200 for application-level failures.** Branch on `statusCode`;
`S1000` is the only success. `E1351` on Register, `E1356` on Unregister and `E1379` on a
debit retry all mean *the desired state already holds* — treat them as success.

## Where the detail lives

`references/01-getting-started.md` through `10-production-checklist.md`, and working
TypeScript in `templates/typescript/`. Read the reference for the service you are building
before writing code.

Related skills: `ideamart-scaffold`, `ideamart-callbacks`, `ideamart-review`,
`ideamart-debug`, `ideamart-golive`.
