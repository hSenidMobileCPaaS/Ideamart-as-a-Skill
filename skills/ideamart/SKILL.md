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
node tools/ideamart.mjs list                          # what exists
node tools/ideamart.mjs show <id>                     # exact contract
node tools/ideamart.mjs curl <id> [key=value ...]     # runnable request + param/response defs
node tools/ideamart.mjs codegen <id> --lang=<lang>    # write the call for me (six languages)
node tools/ideamart.mjs validate <id> '<json>'
node tools/ideamart.mjs code <statusCode>
```

`references/13-curl-reference.md` is the whole contract at the wire — every endpoint as a
runnable curl, every parameter defined, the response and every response field, the status codes
that endpoint returns, and all five callbacks with a command that replays each against your
handler. **That page is the path for any language**, and the first thing to run by hand when a
call fails.

`codegen` targets: any service or callback id, or `client` / `errors` / `types` / `config` /
`callbacks`. Languages: typescript, python, java, go, php, csharp. Generated code carries the
credential injection, the timeout, the `tel:` normaliser, the benign codes and the `statusCode`
branching, so it cannot drift from the contract. No emitter for the project's language? Work
from the curl reference — never add one of these six runtimes to a project written in another.

Full command list: `node tools/ideamart.mjs help`. Add `--json` for machine-readable output.
If you cannot run commands, or Node is not installed, read `catalog/ideamart-api.json` — same
data, plain JSON. The CLI is a documentation reader; the integration itself can be in **any
language**.

## Five rules that are never negotiable

1. **Credentials come from environment variables.** Never hardcoded, never in a client
   bundle, never logged, never committed. Never a browser-exposed prefix
   (`NEXT_PUBLIC_`/`VITE_`/`REACT_APP_`/`PUBLIC_`/`EXPO_PUBLIC_`).
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

## Build it in the project's own stack

Ideamart is JSON over HTTPS: no runtime is privileged, and a Node sidecar for a Python, Java,
Go, PHP or .NET project is the wrong answer. Every call is one HTTPS POST with a JSON body —
`references/13-curl-reference.md` has all of them, so Ruby, Rust, Kotlin, Elixir or anything
else is a first-class target. Working implementations for six languages ship in `templates/`
(see `templates/README.md`); `references/11-any-stack.md` specifies the same seven components
language-neutrally, with an acceptance checklist for stacks with no template.

## Where the detail lives

`references/01-getting-started.md` through `13-curl-reference.md`, and the per-language
implementations in `templates/`. Read the reference for the service you are building before
writing code.

Taking a project from nothing to production — or adding Ideamart to an app that already has
users — is `references/12-implementation-playbook.md`.

Related skills: `ideamart-scaffold`, `ideamart-callbacks`, `ideamart-review`,
`ideamart-debug`, `ideamart-golive`.
