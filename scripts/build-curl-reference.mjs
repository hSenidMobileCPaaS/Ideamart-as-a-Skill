#!/usr/bin/env node
/**
 * Generate references/13-curl-reference.md from catalog/ideamart-api.json.
 *
 *   node scripts/build-curl-reference.mjs           write the document
 *   node scripts/build-curl-reference.mjs --check   fail if it is stale (used in CI)
 *
 * The curl reference is the tool-free path into Ideamart: every endpoint, every
 * parameter definition, a runnable request and the response it returns, so a
 * stack with no template and no emitter can still be integrated correctly.
 *
 * It is generated rather than hand-written for the same reason the agent rule
 * copies are: a parameter that drifts from the catalog becomes a wrong parameter
 * in someone's production integration.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { catalog, lookupStatusCode, repoRoot, urlFor } from "../tools/catalog.mjs";

const OUT = join(repoRoot, "references", "13-curl-reference.md");
const check = process.argv.includes("--check");

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const md = (s) => String(s).replace(/\|/g, "\\|");

/** Anchor for the in-page index, matching GitHub's slug rules. */
const anchor = (heading) =>
  heading
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * The example body for a service: credentials as environment placeholders, then
 * every parameter the official sample carries, in the order the contract
 * declares them. Required parameters with no sample value get a named
 * placeholder so nothing runnable is silently missing.
 */
function exampleBody(service) {
  const body = {
    applicationId: "$IDEAMART_APP_ID",
    password: "$IDEAMART_PASSWORD",
  };
  for (const p of service.parameters || []) {
    if (p.name === "applicationId" || p.name === "password") continue;
    const sample = service.sampleRequest?.[p.name];
    if (sample !== undefined) body[p.name] = sample;
    else if (p.required) body[p.name] = `<${p.name}>`;
  }
  return body;
}

function parameterTable(spec, { label = "Parameter", required = "Required" } = {}) {
  const rows = spec.map((p) => {
    const type = p.enum ? `enum` : p.type;
    const values = p.enum ? ` One of \`${p.enum.join("\`, \`")}\`.` : "";
    const need = p.required ? `**${required}**` : "Optional";
    return `| \`${p.name}\` | ${type} | ${need} | ${md(p.description)}${md(values)} |`;
  });
  return [`| ${label} | Type | | Definition |`, `|---|---|---|---|`, ...rows].join("\n");
}

function responseTable(fields) {
  return [
    `| Field | Type | Meaning |`,
    `|---|---|---|`,
    ...fields.map((f) => `| \`${f.name}\` | ${f.type} | ${md(f.description)} |`),
  ].join("\n");
}

/**
 * Per-code rows carry only the fix specific to that code; the generic per-class
 * advice is stated once in the legend rather than repeated on every row.
 */
function statusTable(codes, entryId) {
  const rows = codes.map((code) => {
    const s = lookupStatusCode(code);
    const specificFix = catalog.statusCodes[s.code]?.fix;
    const benign = s.benignFor?.includes(entryId) ? " **Treat this as success.**" : "";
    const fix = specificFix ? ` → ${md(specificFix)}` : "";
    return `| \`${s.code}\` | ${s.class} | ${md(s.description)}${fix}${benign} |`;
  });
  return [`| Code | Class | Meaning |`, `|---|---|---|`, ...rows].join("\n");
}

const CLASS_LEGEND =
  "`configuration` fix the portal, not the code — the integration is down, not one request · " +
  "`client` fix the payload or the user's input · " +
  "`user-state` the user is not eligible right now; tell them, do not loop · " +
  "`transient` retry with capped exponential backoff. " +
  "Full table: [08-status-codes.md](08-status-codes.md).";

const json = (value) => "```json\n" + JSON.stringify(value, null, 2) + "\n```";

/** A runnable request. The heredoc is unquoted so the credential variables expand. */
function requestCurl(service) {
  const body = JSON.stringify(exampleBody(service), null, 2);
  return [
    "```bash",
    `curl -sS -X POST "$${service.envVar}" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  --max-time 15 \\`,
    `  -d @- <<REQUEST`,
    body,
    "REQUEST",
    "```",
  ].join("\n");
}

/** A request that replays what Ideamart sends, against your own handler. */
function callbackCurl(cb) {
  const body = JSON.stringify(cb.samplePayload, null, 2);
  return [
    "```bash",
    `curl -sS -X POST "http://localhost:3000${cb.suggestedPath}" \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d @- <<'PAYLOAD'`,
    body,
    "PAYLOAD",
    "```",
  ].join("\n");
}

/* ── Document ────────────────────────────────────────────────────────────── */

const services = catalog.services;
const callbacks = catalog.callbacks;

const preamble = `<!-- Generated from catalog/ideamart-api.json by scripts/build-curl-reference.mjs. Do not edit directly. -->

# Every Endpoint as curl

The whole Ideamart contract at the wire: each endpoint, each parameter defined, a request you
can run, and the response it returns. No SDK, no generated code, no tooling of any kind between
you and the platform.

**This is the path for any language.** A stack with no template and no emitter needs nothing
more than this page: the body, the headers and the branching are identical whether the call
goes out through \`requests\` in Python, \`HttpClient\` in Java or .NET, \`net/http\` in Go, Guzzle in
PHP, \`Net::HTTP\` in Ruby, \`reqwest\` in Rust, \`HTTPoison\` in Elixir or \`fetch\` in Node. Translate
the curl, keep everything else.

Run these against a real application to confirm provisioning and credentials before writing a
line of code — a working curl removes half the possible causes when the integration then fails.

---

## The shape of every call

\`\`\`
POST  ${catalog.baseUrls.primary}/<service-path>
Content-Type: application/json
\`\`\`

- **Credentials travel in the JSON body**, as \`applicationId\` and \`password\`. There are no
  headers, no tokens, no signatures and no OAuth on this platform.
- **Every response is HTTP 200**, including failures. ${catalog.conventions.responseEnvelope.criticalNote}
- Every response carries \`${catalog.conventions.responseEnvelope.always.join("\` and \`")}\`; most also carry
  \`${catalog.conventions.responseEnvelope.common.join("\` and \`")}\`.
- Subscriber addresses are always \`${catalog.conventions.addressing.format}\` — no \`+\`, no spaces.
  A masked application receives a hash (\`tel:hu3b84346f…\`) instead of a number; it is opaque,
  so send back exactly what you received.
- **LBS is on a different host** (\`${catalog.baseUrls.lbs}\`) from everything else.

## Before you run anything

Export your credentials and the endpoints your application is provisioned for. Every command on
this page reads them from the environment, so nothing here contains a credential and nothing you
copy can commit one.

\`\`\`bash
export IDEAMART_APP_ID='APP_XXXXXX'
export IDEAMART_PASSWORD='…'                 # from the portal — never commit it
${[...new Map(services.map((s) => [s.envVar, `export ${s.envVar}='${urlFor(s)}'`])).values()].join("\n")}
\`\`\`

One variable per provisioned service, never one shared base URL: an application can only call
the APIs it was provisioned for, so an endpoint you have no variable for is one you must not
call. ${catalog.baseUrls.alias} is an alias for ${catalog.baseUrls.primary} and either works.

Windows PowerShell, where \`curl\` is an alias for \`Invoke-WebRequest\` and the syntax differs:

\`\`\`powershell
$body = @{ applicationId = $env:IDEAMART_APP_ID; password = $env:IDEAMART_PASSWORD } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $env:IDEAMART_SUBSCRIPTION_QUERY_BASE_URL \`
  -ContentType 'application/json' -Body $body
\`\`\`

Three flags in every request below, all deliberate: \`-sS\` prints errors but not a progress bar,
\`--max-time 15\` stops a hung call holding a request thread, and \`-d @- <<REQUEST\` reads the body
from a heredoc so the credential variables expand and the JSON stays readable.

**Start with Query Base.** It needs no subscriber, costs nothing and touches no one, so it is
the safest way to prove that your credentials, your provisioning and your egress IP all work.

---

## Endpoint index

| Service | Endpoint | Environment variable |
|---|---|---|
${services
  .map(
    (s) =>
      `| [${s.name}](#${anchor(s.name)}) | \`POST ${urlFor(s)}\` | \`${s.envVar}\` |`
  )
  .join("\n")}

| Callback | Ideamart calls | Configured in |
|---|---|---|
${callbacks
  .map(
    (c) =>
      `| [${c.name}](#${anchor(c.name)}) | \`POST <your-host>${c.suggestedPath}\` | ${c.configuredIn} |`
  )
  .join("\n")}

---

# Outbound services — you call Ideamart
`;

function serviceSection(s) {
  const parts = [];
  parts.push(`---\n`);
  parts.push(`## ${s.name}\n`);
  parts.push(`${s.summary}\n`);

  const facts = [
    `| | |`,
    `|---|---|`,
    `| **Endpoint** | \`POST ${urlFor(s)}\` |`,
    `| **Environment variable** | \`${s.envVar}\` |`,
    `| **Content type** | \`application/json\` |`,
    `| **Full guide** | [${s.reference.replace("references/", "")}](${s.reference.replace("references/", "")}) |`,
  ];
  parts.push(facts.join("\n") + "\n");

  if (s.movesMoney) {
    parts.push(
      `> **This call moves real money.** \`${s.idempotencyKey}\` is the idempotency key: generate it,\n` +
        `> persist it *before* sending, and reuse it unchanged on every resolution attempt. A retry with\n` +
        `> a fresh one charges a real person twice.\n`
    );
  }
  if (s.requiresProvisioning) {
    parts.push(
      `> **Needs provisioning:** ${s.requiresProvisioning}. Without it the call fails no matter how\n` +
        `> correct the payload is.\n`
    );
  }

  parts.push(`### Request parameters\n`);
  parts.push(parameterTable(s.parameters) + "\n");

  parts.push(`### Request\n`);
  parts.push(requestCurl(s) + "\n");

  parts.push(`### Response\n`);
  parts.push(`HTTP 200. Success is \`statusCode: "S1000"\` — nothing else.\n`);
  parts.push(json(s.sampleResponse) + "\n");

  if (s.responseFields?.length) {
    parts.push(`### Response fields\n`);
    parts.push(responseTable(s.responseFields) + "\n");
  }

  if (s.statusCodes?.length) {
    parts.push(`### Status codes for this endpoint\n`);
    parts.push(statusTable(s.statusCodes, s.id) + "\n");
    parts.push(CLASS_LEGEND + "\n");
  }

  if (s.rules?.length) {
    parts.push(`### Rules\n`);
    parts.push(s.rules.map((r) => `- ${r}`).join("\n") + "\n");
  }

  return parts.join("\n");
}

function callbackSection(c) {
  const parts = [];
  parts.push(`---\n`);
  parts.push(`## ${c.name}\n`);
  parts.push(`${c.summary}\n`);

  parts.push(
    [
      `| | |`,
      `|---|---|`,
      `| **Direction** | Ideamart → you. There is nothing to call. |`,
      `| **Your route** | \`POST <your-host>${c.suggestedPath}\` (the path is yours; register it in the portal) |`,
      `| **Configured in** | ${c.configuredIn} |`,
      `| **Deduplicate on** | \`${c.dedupeKey}\` |`,
      `| **Full guide** | [${c.reference.replace("references/", "")}](${c.reference.replace("references/", "")}) |`,
    ].join("\n") + "\n"
  );

  parts.push(`### Payload fields\n`);
  parts.push(parameterTable(c.fields, { label: "Field", required: "Always sent" }) + "\n");

  parts.push(`### What arrives\n`);
  parts.push(json(c.samplePayload) + "\n");

  parts.push(`### What you must respond\n`);
  parts.push(`HTTP 200, immediately, before doing any work:\n`);
  parts.push(json(catalog.conventions.callbackAck) + "\n");

  parts.push(`### Replay it against your own handler\n`);
  parts.push(callbackCurl(c) + "\n");

  if (c.rules?.length) {
    parts.push(`### Rules\n`);
    parts.push(c.rules.map((r) => `- ${r}`).join("\n") + "\n");
  }

  return parts.join("\n");
}

const epilogue = `---

## What a curl does not show

Every command above is one HTTPS POST, and that part ports to any language in a few lines. The
difference between a working call and a production integration is what surrounds it — none of
which is visible in a shell command:

| | Why the curl hides it |
|---|---|
| **Credentials from the environment, injected once** | A shell export becomes a config module that validates at startup and fails loudly. One place reads it; no call site passes credentials as arguments. |
| **\`statusCode\` branching** | You read the JSON yourself here. Code that checks \`res.ok\`, \`raise_for_status()\` or \`EnsureSuccessStatusCode()\` reports every Ideamart failure as a success. |
| **Benign codes** | \`E1351\` on register, \`E1356\` on unregister and \`E1379\` on debit all mean the desired state already holds. They are successes, and only your code can know that. |
| **Idempotency** | \`externalTrxId\` has to be generated, persisted before the call, and reused unchanged on retry. A shell loop cannot do this; a ledger row can. |
| **Timeouts and retries** | \`--max-time 15\` becomes an explicit client timeout, with backoff on transient codes only and no automatic retry at all on a debit. |
| **\`tel:\` normalisation** | Typed by hand here; in code it is one function at the boundary, never a concatenation at a call site. |
| **Acknowledge-first callbacks** | The replay commands return instantly. A real handler must respond \`S1000\` and then work out of band — USSD sessions time out in seconds. |

Those seven, plus a shared USSD session store, are the whole specification. They are written out
language-neutrally in [11-any-stack.md](11-any-stack.md), with an acceptance checklist for a
port, and as working code in [templates/](../templates/README.md) for TypeScript/Node, Python,
Java, Go, PHP and C#.

## Related

| | |
|---|---|
| Machine-readable form of this page | [\`catalog/ideamart-api.json\`](../catalog/ideamart-api.json) |
| Build a request with your own values | \`node tools/ideamart.mjs curl <id> key=value …\` |
| The same call as code, where an emitter exists | \`node tools/ideamart.mjs codegen <id> --lang=<language>\` |
| Check a payload before sending it | \`node tools/ideamart.mjs validate <id> '<json>'\` |
| Decode a status code you received | \`node tools/ideamart.mjs code <statusCode>\` |
| Smoke-test the outbound path | [\`scripts/smoke-test.sh\`](../scripts/smoke-test.sh) (or \`smoke-test.ps1\`) |
| Test all five callback handlers | [\`scripts/test-callbacks.sh\`](../scripts/test-callbacks.sh) |
| Every status code, classified | [08-status-codes.md](08-status-codes.md) |
`;

const document = [
  preamble,
  ...services.map(serviceSection),
  `---\n\n# Inbound callbacks — Ideamart calls you\n`,
  ...callbacks.map(callbackSection),
  epilogue,
].join("\n");

/* ── Write or check ──────────────────────────────────────────────────────── */

const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : null;

if (current === document) {
  console.log("references/13-curl-reference.md is in sync with the catalog.");
} else if (check) {
  console.error(
    "stale: references/13-curl-reference.md\n\n" +
      "The curl reference no longer matches catalog/ideamart-api.json. Run\n" +
      "`node scripts/build-curl-reference.mjs` and commit the result."
  );
  process.exit(1);
} else {
  writeFileSync(OUT, document);
  console.log(
    `wrote references/13-curl-reference.md — ${services.length} endpoints, ${callbacks.length} callbacks.`
  );
}
