import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  allEntries,
  buildPayload,
  catalog,
  diagnose,
  findEntry,
  lookupStatusCode,
  repoRoot,
  search,
  toCurl,
  urlFor,
  validatePayload,
} from "../tools/catalog.mjs";

/* ── Catalog integrity ───────────────────────────────────────────────────── */

test("catalog declares the Sri Lankan operators and no others", () => {
  const names = catalog.operators.map((o) => o.name).sort();
  assert.deepEqual(names, ["Airtel", "Dialog", "Hutch"]);
  assert.equal(catalog.platform.market, "Sri Lanka");
});

test("every service has a unique id, path, parameters and a sample", () => {
  const ids = new Set();
  for (const s of catalog.services) {
    assert.ok(s.id, "service missing id");
    assert.ok(!ids.has(s.id), `duplicate service id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.path, `${s.id} missing path`);
    assert.equal(s.method, "POST", `${s.id} should be POST`);
    assert.ok(s.parameters?.length, `${s.id} has no parameters`);
    assert.ok(s.sampleRequest, `${s.id} has no sampleRequest`);
    assert.ok(s.summary, `${s.id} has no summary`);
  }
});

test("every outbound service requires applicationId and password", () => {
  for (const s of catalog.services) {
    const names = s.parameters.map((p) => p.name);
    assert.ok(names.includes("applicationId"), `${s.id} missing applicationId`);
    assert.ok(names.includes("password"), `${s.id} missing password`);
    for (const field of ["applicationId", "password"]) {
      const p = s.parameters.find((x) => x.name === field);
      assert.equal(p.required, true, `${s.id}.${field} should be required`);
    }
  }
});

test("every callback declares a dedupe key and a route", () => {
  assert.ok(catalog.callbacks.length >= 5, "expected at least five callbacks");
  for (const cb of catalog.callbacks) {
    assert.ok(cb.dedupeKey, `${cb.id} missing dedupeKey — callbacks must be idempotent`);
    assert.ok(cb.suggestedPath?.startsWith("/"), `${cb.id} suggestedPath must be a route`);
  }
});

test("documented callbacks carry fields and a sample; undocumented ones say so", () => {
  for (const cb of catalog.callbacks) {
    if (cb.payloadDocumented === false) {
      // We must not invent a schema. Absence has to be explicit and explained.
      assert.equal(cb.samplePayload, null, `${cb.id} claims undocumented but has a sample`);
      assert.deepEqual(cb.fields, [], `${cb.id} claims undocumented but lists fields`);
      assert.ok(
        cb.rules.some((r) => /not published|not documented/i.test(r)),
        `${cb.id} must state that its payload is not published`
      );
      continue;
    }
    assert.ok(cb.fields?.length, `${cb.id} has no fields`);
    assert.ok(cb.samplePayload, `${cb.id} has no samplePayload`);
  }
});

test("every status code referenced by a service exists in the code table", () => {
  for (const e of allEntries()) {
    for (const code of e.statusCodes || []) {
      assert.ok(catalog.statusCodes[code], `${e.id} references unknown status code ${code}`);
    }
  }
});

test("every status code has a known handling class", () => {
  const classes = new Set(Object.keys(catalog.statusCodeClasses));
  for (const [code, meta] of Object.entries(catalog.statusCodes)) {
    assert.ok(classes.has(meta.class), `${code} has unknown class "${meta.class}"`);
    assert.ok(meta.description, `${code} has no description`);
  }
});

test("every parameter is fully specified", () => {
  for (const e of allEntries()) {
    for (const p of e.parameters || e.fields || []) {
      assert.ok(p.name, `${e.id} has an unnamed parameter`);
      assert.ok(p.type, `${e.id}.${p.name} has no type`);
      assert.equal(typeof p.required, "boolean", `${e.id}.${p.name} has no required flag`);
      assert.ok(p.description, `${e.id}.${p.name} has no description`);
    }
  }
});

test("every reference path in the catalog points at a real file", () => {
  const refs = new Set();
  for (const e of allEntries()) if (e.reference) refs.add(e.reference);
  for (const p of catalog.practices) refs.add(p.reference);
  for (const ref of refs) {
    assert.ok(existsSync(join(repoRoot, ref)), `missing referenced file: ${ref}`);
  }
});

test("the benign codes are marked benign for the right operations", () => {
  assert.deepEqual(lookupStatusCode("E1351").benignFor, ["subscription-register"]);
  assert.deepEqual(lookupStatusCode("E1356").benignFor, ["subscription-unregister"]);
  assert.deepEqual(lookupStatusCode("E1379").benignFor, ["caas-direct-debit"]);
});

test("E1303 and E1313 are configuration-class and never retryable", () => {
  for (const code of ["E1303", "E1313", "E1309"]) {
    const info = lookupStatusCode(code);
    assert.equal(info.class, "configuration", `${code} should be configuration-class`);
    assert.equal(info.retry, false, `${code} must never be retried`);
  }
});

test("the charging service is flagged as moving money and has an idempotency key", () => {
  const debit = findEntry("caas-direct-debit");
  assert.equal(debit.movesMoney, true);
  assert.equal(debit.idempotencyKey, "externalTrxId");
});

test("no real credential-shaped string appears in the catalog", () => {
  const raw = readFileSync(join(repoRoot, "catalog", "ideamart-api.json"), "utf8");
  const hexSecret = /"password"\s*:\s*"[0-9a-f]{16,}"/i;
  assert.equal(hexSecret.test(raw), false, "catalog contains a credential-shaped password value");
});

/* ── Lookup ──────────────────────────────────────────────────────────────── */

test("services resolve by id, name and alias", () => {
  assert.equal(findEntry("subscription-unregister").id, "subscription-unregister");
  assert.equal(findEntry("unsub").id, "subscription-unregister");
  assert.equal(findEntry("UNSUB").id, "subscription-unregister");
  assert.equal(findEntry("Query Base (subscriber base size)").id, "subscription-query-base");
  assert.equal(findEntry("nope"), null);
});

test("LBS resolves to its own host, not the main base URL", () => {
  const lbs = findEntry("lbs-locate");
  assert.equal(urlFor(lbs), "https://api.dialog.lk/lbs/locate");
  assert.equal(urlFor(findEntry("sms-send")), "https://api.ideamart.io/sms/send");
});

test("unknown status codes degrade gracefully", () => {
  const unknown = lookupStatusCode("E9999");
  assert.equal(unknown.known, false);
  assert.equal(unknown.class, "unknown");
  assert.equal(lookupStatusCode("S9999").class, "success");
});

test("search finds services by intent, not just by id", () => {
  assert.ok(search("base size").some((r) => r.id === "subscription-query-base"));
  assert.ok(search("opt out").some((r) => r.id === "subscription-unregister"));
  assert.ok(search("E1303").some((r) => r.id === "E1303"));
  assert.equal(search("").length, 0);
});

/* ── Validation ──────────────────────────────────────────────────────────── */

test("validation catches destinationAddresses sent as a string", () => {
  const result = validatePayload(findEntry("sms-send"), {
    applicationId: "APP_000001",
    password: "x",
    message: "hi",
    destinationAddresses: "tel:94771234567",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("must be an ARRAY")));
});

test("validation catches a missing tel: prefix", () => {
  const result = validatePayload(findEntry("subscription-register"), {
    applicationId: "APP_000001",
    password: "x",
    action: "1",
    subscriberId: "94771234567",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("tel:")));
});

test("validation catches a bad enum value", () => {
  const result = validatePayload(findEntry("subscription-register"), {
    applicationId: "APP_000001",
    password: "x",
    action: "yes",
    subscriberId: "tel:94771234567",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("must be one of")));
});

test("validation rejects an oversized externalTrxId", () => {
  const result = validatePayload(findEntry("caas-direct-debit"), {
    applicationId: "APP_000001",
    password: "x",
    externalTrxId: "x".repeat(33),
    subscriberId: "tel:94771234567",
    amount: "1",
    paymentInstrument: "MobileAccount",
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("32 characters")));
});

test("validation warns loudly about a broadcast", () => {
  const result = validatePayload(findEntry("sms-send"), {
    applicationId: "APP_000001",
    password: "x",
    message: "hi",
    destinationAddresses: ["tel:all"],
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some((w) => w.includes("ENTIRE subscriber base")));
});

test("validation warns that charging moves real money", () => {
  const result = validatePayload(findEntry("caas-direct-debit"), {
    applicationId: "APP_000001",
    password: "x",
    externalTrxId: "abc",
    subscriberId: "tel:94771234567",
    amount: "1",
    paymentInstrument: "MobileAccount",
  });
  assert.ok(result.warnings.some((w) => w.includes("real money")));
});

test("a well-formed payload validates", () => {
  const result = validatePayload(findEntry("sms-send"), {
    applicationId: "APP_000001",
    password: "x",
    message: "hi",
    destinationAddresses: ["tel:94771234567"],
  });
  assert.equal(result.valid, true, result.errors.join("; "));
});

test("every documented sample request validates against its own spec", () => {
  for (const s of catalog.services) {
    const payload = { ...s.sampleRequest, applicationId: "APP_000001", password: "x" };
    const result = validatePayload(s, payload);
    assert.equal(result.valid, true, `${s.id} sample is invalid: ${result.errors.join("; ")}`);
  }
});

/* ── Building ────────────────────────────────────────────────────────────── */

test("built payloads never contain a literal credential", () => {
  for (const s of catalog.services) {
    const payload = buildPayload(s, {});
    assert.equal(payload.applicationId, "$IDEAMART_APP_ID");
    assert.equal(payload.password, "$IDEAMART_PASSWORD");
  }
});

test("curl output is a single runnable POST with a JSON body", () => {
  const s = findEntry("subscription-query-base");
  const curl = toCurl(s, buildPayload(s, {}));
  assert.match(curl, /^curl -X POST 'https:\/\/api\.ideamart\.io\/subscription\/query-base'/);
  assert.match(curl, /Content-Type: application\/json/);
  assert.match(curl, /--data '/);
});

/* ── Diagnosis ───────────────────────────────────────────────────────────── */

test("diagnose extracts a status code from free text", () => {
  const d = diagnose("everything returns E1303 in production");
  assert.equal(d.matchedOn, "statusCode");
  assert.equal(d.code, "E1303");
});

test("diagnose matches symptom signatures", () => {
  assert.equal(diagnose("callbacks never arrive").matchedOn, "symptom");
  assert.equal(diagnose("works locally but fails deployed").matchedOn, "symptom");
  assert.match(diagnose("we double charged a customer").fix, /externalTrxId/);
});

test("diagnose degrades to search when nothing matches", () => {
  const d = diagnose("subscription");
  assert.equal(d.matchedOn, "none");
  assert.ok(Array.isArray(d.searchResults));
});

/* ── Repo consistency ────────────────────────────────────────────────────── */

test("all ten reference documents exist", () => {
  const files = readdirSync(join(repoRoot, "references")).filter((f) => f.endsWith(".md"));
  assert.equal(files.length, 10, `expected 10 reference docs, found ${files.length}`);
});

/**
 * The environment surface is deliberately tiny: two credentials, plus one URL
 * per provisionable service. Anything else (timeouts, encodings, retry counts)
 * belongs in code as a constant — it is a property of the protocol, not of the
 * deployment. This test stops that surface creeping back.
 */
test("the env example exposes only credentials and per-service endpoints", () => {
  const example = readFileSync(join(repoRoot, "templates", ".env.example"), "utf8");
  const declared = [...example.matchAll(/^#?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

  const allowed = new Set([
    "IDEAMART_APP_ID",
    "IDEAMART_PASSWORD",
    "IDEAMART_SMS_SEND_URL",
    "IDEAMART_USSD_SEND_URL",
    "IDEAMART_SUBSCRIPTION_SEND_URL",
    "IDEAMART_SUBSCRIPTION_STATUS_URL",
    "IDEAMART_SUBSCRIPTION_QUERY_BASE_URL",
    "IDEAMART_OTP_REQUEST_URL",
    "IDEAMART_OTP_VERIFY_URL",
    "IDEAMART_CAAS_DEBIT_URL",
    "IDEAMART_CAAS_BALANCE_URL",
    "IDEAMART_LBS_URL",
  ]);

  const unexpected = declared.filter((v) => !allowed.has(v));
  assert.deepEqual(unexpected, [], `unexpected env vars in .env.example: ${unexpected.join(", ")}`);

  for (const required of ["IDEAMART_APP_ID", "IDEAMART_PASSWORD"]) {
    assert.ok(declared.includes(required), `.env.example is missing ${required}`);
  }
});

test("every service endpoint variable maps to a real catalog service", () => {
  const example = readFileSync(join(repoRoot, "templates", ".env.example"), "utf8");
  const urls = [...example.matchAll(/^#?IDEAMART_\w+_URL=(\S+)/gm)].map((m) => m[1]);
  const known = new Set(
    catalog.services.map((s) => s.absoluteUrl || `${catalog.baseUrls.primary}${s.path}`)
  );
  for (const url of urls) {
    assert.ok(known.has(url), `.env.example lists ${url}, which is not a catalog endpoint`);
  }
});

/**
 * The same three patterns the CI secrets job runs, so a leak fails locally
 * before it reaches a push. These detect what a real credential looks like
 * rather than allowlisting placeholder spellings — a real Ideamart password is
 * a long unbroken alphanumeric run, which "replace-me", "…", "" and "$VAR"
 * never are.
 */
test("no credential-shaped string is committed anywhere", () => {
  const patterns = [
    { name: "JSON password value", re: /"password"\s*:\s*"[A-Za-z0-9]{16,}"/ },
    { name: "env password value", re: /IDEAMART_PASSWORD=[A-Za-z0-9]{12,}/ },
  ];

  // ci.yml is excluded because it contains the patterns as its own source text.
  // Nothing else is excluded — including this file, which is why the fixture
  // below is generated at runtime rather than written as a literal.
  const skipDirs = new Set([".git", "node_modules"]);
  const skipFiles = new Set(["ci.yml"]);
  const offenders = [];

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(join(dir, entry.name));
        continue;
      }
      if (skipFiles.has(entry.name)) continue;
      const path = join(dir, entry.name);
      let content;
      try {
        content = readFileSync(path, "utf8");
      } catch {
        continue; // binary or unreadable
      }
      for (const { name, re } of patterns) {
        if (re.test(content)) {
          offenders.push(`${path.replace(repoRoot, ".")} — ${name}`);
        }
      }
    }
  };

  walk(repoRoot);
  assert.deepEqual(
    offenders,
    [],
    `credential-shaped strings found:\n${offenders.join("\n")}\n` +
      `Rotate the credential in the Ideamart portal before anything else — see SECURITY.md.`
  );
});

test("documented placeholders do not trip the credential scan", () => {
  // Regression guard: these are the placeholder spellings actually used in the
  // repo. An earlier allowlist-based scan broke CI when "…" was introduced.
  const envRe = /IDEAMART_PASSWORD=[A-Za-z0-9]{12,}/;
  for (const placeholder of [
    "IDEAMART_PASSWORD=replace-me",
    "IDEAMART_PASSWORD=…",
    "IDEAMART_PASSWORD=",
    "IDEAMART_PASSWORD=$IDEAMART_PASSWORD",
    "IDEAMART_PASSWORD=<your-password>",
  ]) {
    assert.equal(envRe.test(placeholder), false, `"${placeholder}" must not be flagged`);
  }
  // ...but a real one must still be caught.
  //
  // Generated at runtime, never written as a literal: a credential-shaped
  // string committed here would be flagged by the very scan it is testing,
  // which is exactly what happened the first time round.
  const credentialShaped = randomBytes(16).toString("hex"); // 32 hex chars
  assert.equal(envRe.test(`IDEAMART_PASSWORD=${credentialShaped}`), true);
});

test("the only contact number in the docs is the support WhatsApp number", () => {
  assert.equal(catalog.platform.support.whatsapp, "+94767412345");
  const docs = readdirSync(join(repoRoot, "references"))
    .map((f) => readFileSync(join(repoRoot, "references", f), "utf8"))
    .join("\n");
  const contactish = docs.match(/\b0\d{9}\b/g) || [];
  assert.deepEqual(contactish, [], `found local-format phone numbers: ${contactish.join(", ")}`);
});
