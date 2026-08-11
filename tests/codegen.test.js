import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { catalog, repoRoot } from "../tools/catalog.mjs";
import { LANGUAGES, TARGETS, generate, planService } from "../tools/codegen.mjs";

const languages = Object.keys(LANGUAGES);
const services = catalog.services.map((s) => s.id);
const callbacks = catalog.callbacks.map((c) => c.id);
const bundles = ["client", "errors", "types", "config", "callbacks"];

/* ── Coverage ────────────────────────────────────────────────────────────── */

/**
 * The promise is "any Ideamart API, any of the six languages". A service that
 * generates in five of them is a broken promise, so assert the whole matrix.
 */
test("every service generates in every language", () => {
  for (const id of services) {
    for (const lang of languages) {
      const result = generate(id, lang);
      assert.ok(result.code.length > 200, `${id}/${lang} produced almost nothing`);
      assert.equal(result.language, lang);
    }
  }
});

test("every callback generates a handler in every language", () => {
  for (const id of callbacks) {
    for (const lang of languages) {
      const result = generate(id, lang);
      assert.match(result.code, /S1000/, `${id}/${lang} handler must acknowledge with S1000`);
    }
  }
});

test("every bundle target generates in every language", () => {
  for (const target of bundles) {
    for (const lang of languages) {
      assert.doesNotThrow(() => generate(target, lang), `${target}/${lang} failed`);
    }
  }
});

test("language aliases resolve", () => {
  for (const alias of ["ts", "js", "py", "golang", "c#", "dotnet"]) {
    assert.doesNotThrow(() => generate("errors", alias), `alias ${alias} did not resolve`);
  }
  assert.throws(() => generate("errors", "cobol"), /Unknown language/);
  assert.throws(() => generate("not-a-service", "python"), /Unknown target/);
});

/* ── Correctness of the generated code ───────────────────────────────────── */

test("no generated client decides success on the HTTP status", () => {
  for (const lang of languages) {
    const { code } = generate("client", lang);
    assert.match(code, /S1000/, `${lang} client never checks statusCode`);
    for (const forbidden of [/res\.ok/, /raise_for_status/, /EnsureSuccessStatusCode/, /http_errors/]) {
      assert.doesNotMatch(code, forbidden, `${lang} client checks the HTTP status`);
    }
  }
});

/** Strip comments and docstrings so assertions test the code, not the documentation. */
const codeOnly = (text) =>
  text
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|#)/.test(line))
    .join("\n");

test("generated clients never inline a credential or a URL", () => {
  for (const lang of languages) {
    const { code } = generate("client", lang);
    assert.match(code, /IDEAMART_APP_ID/, `${lang} client does not read the app id from the env`);
    assert.match(code, /IDEAMART_PASSWORD/, `${lang} client does not read the password from the env`);
    assert.doesNotMatch(
      codeOnly(code),
      /https:\/\/api\.(ideamart\.io|dialog\.lk)\/[a-z]/,
      `${lang} client inlines an endpoint URL instead of reading it from the environment`
    );
    // A hardcoded credential is the one thing that must never appear.
    assert.doesNotMatch(codeOnly(code), /APP_\d{6}/, `${lang} client inlines an application id`);
  }
});

test("the money path carries its guards in every language", () => {
  for (const lang of languages) {
    const { code } = generate("caas-direct-debit", lang);
    assert.match(code, /MOVES REAL MONEY/i, `${lang} debit is not marked as moving money`);
    assert.match(code, /32/, `${lang} debit does not bound externalTrxId`);
    assert.match(code, /E1379/, `${lang} debit does not treat E1379 as benign`);
  }
});

test("benign codes reach the generated call for the operations that have them", () => {
  const expected = {
    "subscription-register": "E1351",
    "subscription-unregister": "E1356",
    "caas-direct-debit": "E1379",
  };
  for (const [id, code] of Object.entries(expected)) {
    for (const lang of languages) {
      assert.match(generate(id, lang).code, new RegExp(code), `${id}/${lang} lost ${code}`);
    }
  }
});

test("broadcasts are blocked in the ordinary send path", () => {
  for (const lang of languages) {
    assert.match(
      generate("sms-send", lang).code,
      /tel:all/,
      `${lang} sendSms does not guard against tel:all`
    );
  }
});

test("subscriber addresses go through the tel: normaliser", () => {
  for (const lang of languages) {
    const { code } = generate("subscription-register", lang);
    assert.match(code, /[Tt]o[_]?[Tt]el[_]?[Aa]ddress/, `${lang} register does not normalise tel:`);
  }
});

test("the error module carries every published status code and class", () => {
  const codes = Object.keys(catalog.statusCodes);
  for (const lang of languages) {
    const { code } = generate("errors", lang);
    for (const status of codes) {
      assert.ok(code.includes(status), `${lang} error module is missing ${status}`);
    }
    for (const cls of Object.keys(catalog.statusCodeClasses)) {
      assert.ok(
        code.toLowerCase().includes(cls.replace("-", "").toLowerCase()) ||
          code.includes(cls),
        `${lang} error module is missing the ${cls} class`
      );
    }
  }
});

test("generated code names the catalog version it came from", () => {
  for (const lang of languages) {
    assert.match(generate("client", lang).code, new RegExp(catalog.catalogVersion));
  }
});

/* ── Planning ────────────────────────────────────────────────────────────── */

test("required arguments come before optional ones in every signature", () => {
  for (const service of catalog.services) {
    const plan = planService(service);
    const ranks = plan.args.map((a) => (a.required ? 0 : a.default !== null ? 1 : 2));
    assert.deepEqual(
      ranks,
      [...ranks].sort(),
      `${service.id} would generate optional arguments before required ones`
    );
  }
});

test("every service resolves an endpoint variable that exists in .env.example", () => {
  const example = execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('templates/.env.example','utf8'))"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  for (const service of catalog.services) {
    assert.ok(service.envVar, `${service.id} has no envVar`);
    assert.ok(
      example.includes(service.envVar),
      `${service.envVar} (${service.id}) is missing from templates/.env.example`
    );
  }
});

/* ── CLI ─────────────────────────────────────────────────────────────────── */

const cli = (...args) =>
  execFileSync("node", ["tools/ideamart.mjs", ...args], { cwd: repoRoot, encoding: "utf8" });

test("the CLI exposes codegen and reports its languages and targets", () => {
  assert.match(cli("help"), /codegen/);
  const generated = cli("codegen", "errors", "--lang=python");
  assert.match(generated, /STATUS_CODES/);
});

test("codegen --json returns the filename and the code", () => {
  const payload = JSON.parse(cli("codegen", "sms-send", "--lang=typescript", "--json"));
  assert.equal(payload.language, "typescript");
  assert.equal(payload.filename, "sms-send.ts");
  assert.match(payload.code, /export async function sendSms/);
});

test("codegen fails clearly on an unknown language", () => {
  assert.throws(() => cli("codegen", "sms-send", "--lang=fortran"), /Command failed|status/);
});

test("TARGETS documents every bundle the generator accepts", () => {
  for (const target of bundles) {
    assert.ok(TARGETS.includes(target), `TARGETS is missing ${target}`);
  }
});
