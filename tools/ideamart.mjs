#!/usr/bin/env node
/**
 * ideamart — offline reference CLI for the Ideamart API.
 *
 * Everything an MCP server would expose as tools, exposed as subcommands any
 * agent can run through its shell. No install, no dependencies, no server, no
 * network access, and it never sees your credentials.
 *
 *   node tools/ideamart.mjs <command> [args] [--json]
 *
 * Commands:
 *   list [category] [--direction=outbound|inbound]   List services and callbacks
 *   show <id>                                        Full contract for one
 *   code <statusCode>                                Decode a status code
 *   diagnose <symptom|code>                          Most likely cause + fix
 *   search <query>                                   Search everything
 *   curl <id> [key=value ...]                        Build a runnable request
 *   validate <id> <json|@file|->                     Check a payload
 *   practices [severity]                             Security/reliability rules
 *   checklist                                        Go-live checklist
 *   reference <doc>                                  Print a reference doc
 *   platform                                         Base URLs, operators, conventions
 *   help
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES, TARGETS, generate } from "./codegen.mjs";
import {
  allEntries,
  buildPayload,
  catalog,
  diagnose,
  findEntry,
  lookupStatusCode,
  readReference,
  search,
  toCurl,
  urlFor,
  validatePayload,
} from "./catalog.mjs";

/* ── Output ──────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");
const [command, ...rest] = args;

const isTTY = process.stdout.isTTY;
const c = (code, s) => (isTTY && !JSON_MODE ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c(1, s);
const dim = (s) => c(2, s);
const red = (s) => c(31, s);
const green = (s) => c(32, s);
const yellow = (s) => c(33, s);
const cyan = (s) => c(36, s);

function out(data, render) {
  if (JSON_MODE) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    render(data);
  }
}

function fail(message, data = {}) {
  if (JSON_MODE) console.log(JSON.stringify({ error: message, ...data }, null, 2));
  else console.error(red(`error: ${message}`));
  process.exit(1);
}

const CLASS_COLOR = {
  success: green,
  configuration: red,
  client: yellow,
  "user-state": yellow,
  transient: cyan,
  unknown: dim,
};

/* ── Commands ────────────────────────────────────────────────────────────── */

function cmdList() {
  const category = rest.find((a) => !a.startsWith("--"));
  const dirFlag = rest.find((a) => a.startsWith("--direction="));
  const direction = dirFlag ? dirFlag.split("=")[1] : null;

  const entries = allEntries()
    .filter((e) => !category || e.category === category)
    .filter((e) => !direction || e.direction === direction)
    .map((e) => ({
      id: e.id,
      name: e.name,
      kind: e.kind,
      category: e.category,
      direction: e.direction,
      endpoint: e.kind === "service" ? `POST ${e.absoluteUrl || e.path}` : `POST ${e.suggestedPath}`,
      summary: e.summary,
      movesMoney: e.movesMoney || undefined,
    }));

  if (!entries.length) fail(`No services match "${category || direction}".`);

  out({ count: entries.length, baseUrl: catalog.baseUrls.primary, entries }, (d) => {
    console.log(`\n${bold("Ideamart services")}  ${dim(`base ${d.baseUrl}`)}\n`);
    let group = null;
    for (const e of d.entries) {
      if (e.category !== group) {
        group = e.category;
        console.log(bold(`  ${group.toUpperCase()}`));
      }
      const arrow = e.direction === "outbound" ? "→" : "←";
      const money = e.movesMoney ? red("  $$ real money") : "";
      console.log(`    ${arrow} ${cyan(e.id.padEnd(28))} ${dim(e.endpoint)}${money}`);
      console.log(`      ${dim(e.summary)}`);
    }
    console.log(
      `\n  ${dim("→ you call Ideamart   ← Ideamart calls your callback URL")}` +
        `\n  ${dim(`${d.count} entries. Full contract: ideamart show <id>`)}\n`
    );
  });
}

function cmdShow() {
  const id = rest[0];
  if (!id) fail("usage: ideamart show <id>");
  const entry = findEntry(id);
  if (!entry) {
    fail(`Unknown service "${id}".`, { available: allEntries().map((e) => e.id) });
  }

  const data = {
    ...entry,
    url: entry.kind === "service" ? urlFor(entry) : undefined,
    statusCodeDetail: (entry.statusCodes || []).map(lookupStatusCode),
  };

  out(data, (d) => {
    console.log(`\n${bold(d.name)}  ${dim(`(${d.id})`)}`);
    console.log(`${d.summary}\n`);
    if (d.kind === "service") {
      console.log(`  ${bold("Endpoint")}  POST ${cyan(d.url)}`);
    } else {
      console.log(`  ${bold("Your route")}  POST ${cyan(d.suggestedPath)}   ${dim(`configured in: ${d.configuredIn}`)}`);
      console.log(`  ${bold("Dedupe key")}  ${d.dedupeKey}`);
    }
    if (d.movesMoney) console.log(`  ${red("⚠  This call moves real money.")}`);
    if (d.requiresProvisioning) console.log(`  ${yellow(`⚠  Requires provisioning: ${d.requiresProvisioning}`)}`);

    const spec = d.parameters || d.fields || [];
    console.log(`\n  ${bold(d.kind === "service" ? "Request parameters" : "Payload fields")}`);
    for (const p of spec) {
      const req = p.required ? red("required") : dim("optional");
      const en = p.enum ? dim(`  [${p.enum.join(" | ")}]`) : "";
      console.log(`    ${cyan(p.name.padEnd(24))} ${p.type.padEnd(10)} ${req}${en}`);
      console.log(`      ${dim(p.description)}`);
    }

    if (d.responseFields) {
      console.log(`\n  ${bold("Response fields")}`);
      for (const f of d.responseFields) {
        console.log(`    ${cyan(f.name.padEnd(24))} ${dim(f.description)}`);
      }
    }

    const sampleReq = d.sampleRequest || d.samplePayload;
    if (sampleReq) {
      console.log(`\n  ${bold(d.kind === "service" ? "Sample request" : "Sample payload Ideamart sends you")}`);
      console.log(indent(JSON.stringify(sampleReq, null, 2), 4));
    }
    if (d.sampleResponse) {
      console.log(`\n  ${bold("Sample response")}`);
      console.log(indent(JSON.stringify(d.sampleResponse, null, 2), 4));
    } else if (d.kind === "callback") {
      console.log(`\n  ${bold("You must respond")}`);
      console.log(indent(JSON.stringify(catalog.conventions.callbackAck, null, 2), 4));
    }

    if (d.rules?.length) {
      console.log(`\n  ${bold("Rules")}`);
      d.rules.forEach((r) => console.log(`    ${yellow("!")} ${r}`));
    }
    if (d.statusCodeDetail?.length) {
      console.log(`\n  ${bold("Status codes")}`);
      for (const s of d.statusCodeDetail) {
        const colour = CLASS_COLOR[s.class] || dim;
        console.log(`    ${colour(s.code.padEnd(7))} ${dim(s.class.padEnd(14))} ${s.description}`);
      }
    }
    console.log(`\n  ${dim(`Full guide: ${d.reference}`)}\n`);
  });
}

function cmdCode() {
  const code = rest[0];
  if (!code) fail("usage: ideamart code <statusCode>");
  const info = lookupStatusCode(code);

  out(info, (d) => {
    const colour = CLASS_COLOR[d.class] || dim;
    console.log(`\n  ${colour(bold(d.code))}  ${dim(d.class)}${d.known ? "" : dim("  (not in published list)")}`);
    console.log(`  ${d.description}\n`);
    console.log(`  ${bold("Retry")}   ${d.retry === true ? green("yes, with backoff") : d.retry === "after-user-action" ? yellow("only after user action") : red("no")}`);
    console.log(`  ${bold("Action")}  ${d.action}`);
    if (d.benignFor?.length) {
      console.log(`  ${green(bold("Benign"))}  Treat as SUCCESS for: ${d.benignFor.join(", ")}`);
    }
    if (d.affects?.length) console.log(`  ${dim(`Seen on: ${d.affects.join(", ")}`)}`);
    console.log();
  });
}

function cmdDiagnose() {
  const symptom = rest.join(" ");
  if (!symptom) fail('usage: ideamart diagnose "<symptom or status code>"');
  const d = diagnose(symptom);

  out(d, (r) => {
    console.log();
    if (r.matchedOn === "statusCode") {
      const colour = CLASS_COLOR[r.class] || dim;
      console.log(`  ${colour(bold(r.code))}  ${r.description}\n`);
      console.log(`  ${bold("Fix")}  ${r.action}`);
    } else if (r.matchedOn === "symptom") {
      console.log(`  ${bold("Likely cause")}`);
      console.log(`  ${r.cause}\n`);
      console.log(`  ${bold("Fix")}`);
      console.log(`  ${green(r.fix)}`);
    } else {
      console.log(`  ${yellow("No signature matched.")} ${r.suggestion}`);
      if (r.searchResults?.length) {
        console.log(`\n  ${bold("Closest matches")}`);
        r.searchResults.forEach((x) => console.log(`    ${cyan(x.id.padEnd(28))} ${dim(x.summary?.slice(0, 70) ?? "")}`));
      }
    }
    console.log();
  });
}

function cmdSearch() {
  const query = rest.join(" ");
  if (!query) fail("usage: ideamart search <query>");
  const results = search(query, 20);

  out({ query, results }, (d) => {
    if (!d.results.length) {
      console.log(`\n  ${yellow(`Nothing matched "${d.query}".`)}\n`);
      return;
    }
    console.log(`\n  ${bold(`${d.results.length} results for "${d.query}"`)}\n`);
    for (const r of d.results) {
      console.log(`    ${dim(r.type.padEnd(11))} ${cyan(r.id.padEnd(28))} ${(r.summary || "").slice(0, 64)}`);
    }
    console.log(`\n  ${dim("Detail: ideamart show <id>   or   ideamart code <CODE>")}\n`);
  });
}

function cmdCurl() {
  const id = rest[0];
  if (!id) fail("usage: ideamart curl <id> [key=value ...]");
  const entry = findEntry(id);
  if (!entry) fail(`Unknown service "${id}".`, { available: allEntries().map((e) => e.id) });

  if (entry.kind === "callback") {
    const data = {
      note: `${entry.name} is inbound — Ideamart calls you, you do not call it.`,
      yourRoute: `POST ${entry.suggestedPath}`,
      incomingPayload: entry.samplePayload,
      yourResponse: catalog.conventions.callbackAck,
      testCommand: `curl -X POST 'http://localhost:3000${entry.suggestedPath}' \\\n  --header 'Content-Type: application/json' \\\n  --data '${JSON.stringify(entry.samplePayload)}'`,
    };
    return out(data, (d) => {
      console.log(`\n  ${yellow(d.note)}\n`);
      console.log(`  ${bold("Test your handler with:")}\n`);
      console.log(indent(d.testCommand, 4));
      console.log(`\n  ${bold("It must respond:")} ${JSON.stringify(d.yourResponse)}\n`);
    });
  }

  const values = {};
  for (const pair of rest.slice(1)) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx);
    const raw = pair.slice(idx + 1);
    try {
      values[key] = JSON.parse(raw);
    } catch {
      values[key] = raw;
    }
  }

  const payload = buildPayload(entry, values);
  const validation = validatePayload(entry, payload);
  const curl = toCurl(entry, payload);

  out({ service: entry.id, url: urlFor(entry), payload, curl, validation, rules: entry.rules }, (d) => {
    console.log(`\n${d.curl}\n`);
    if (!d.validation.valid) {
      console.log(`  ${red(bold("Invalid:"))}`);
      d.validation.errors.forEach((e) => console.log(`    ${red("✗")} ${e}`));
    }
    d.validation.warnings.forEach((w) => console.log(`  ${yellow("!")} ${w}`));
    console.log(`\n  ${dim("Credentials are env placeholders — export them, do not paste them in.")}\n`);
  });
}

function cmdValidate() {
  const [id, source] = rest;
  if (!id || !source) fail("usage: ideamart validate <id> <json|@file|->");
  const entry = findEntry(id);
  if (!entry) fail(`Unknown service "${id}".`);

  let raw = source;
  if (source === "-") raw = readFileSync(0, "utf8");
  else if (source.startsWith("@")) raw = readFileSync(source.slice(1), "utf8");

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    fail(`Payload is not valid JSON: ${err.message}`);
  }

  const result = validatePayload(entry, payload);
  out({ service: entry.id, ...result }, (d) => {
    console.log();
    if (d.valid) console.log(`  ${green("✓ valid")}  against ${bold(d.service)}`);
    else {
      console.log(`  ${red(`✗ ${d.errors.length} error(s)`)}  against ${bold(d.service)}`);
      d.errors.forEach((e) => console.log(`    ${red("✗")} ${e}`));
    }
    d.warnings.forEach((w) => console.log(`    ${yellow("!")} ${w}`));
    console.log();
  });
  if (!result.valid) process.exitCode = 1;
}

function cmdPractices() {
  const severity = rest[0];
  const practices = catalog.practices.filter((p) => !severity || p.severity === severity);
  if (!practices.length) fail(`No practices with severity "${severity}". Try: critical, high, medium.`);

  out({ practices }, (d) => {
    console.log(`\n  ${bold("Ideamart practices")}\n`);
    let group = null;
    for (const p of d.practices) {
      if (p.severity !== group) {
        group = p.severity;
        const colour = group === "critical" ? red : group === "high" ? yellow : dim;
        console.log(`  ${colour(bold(group.toUpperCase()))}`);
      }
      console.log(`    ${bold(p.title)}`);
      console.log(`      ${dim(p.detail)}`);
      console.log(`      ${dim(p.reference)}\n`);
    }
  });
}

function cmdChecklist() {
  const doc = readReference("10-production-checklist");
  if (!doc) fail("Checklist not found.");
  if (JSON_MODE) {
    const items = doc
      .split("\n")
      .filter((l) => l.trim().startsWith("- [ ]"))
      .map((l) => l.replace(/^\s*- \[ \]\s*/, "").trim());
    console.log(JSON.stringify({ count: items.length, items }, null, 2));
  } else {
    console.log(doc);
  }
}

function cmdReference() {
  const doc = rest[0];
  if (!doc) {
    const docs = [
      "01-getting-started", "02-sms", "03-ussd", "04-subscription", "05-caas",
      "06-lbs-ivr", "07-callbacks", "08-status-codes",
      "09-security-best-practices", "10-production-checklist", "11-any-stack",
      "12-implementation-playbook",
    ];
    return out({ documents: docs }, (d) => {
      console.log(`\n  ${bold("Reference documents")}\n`);
      d.documents.forEach((x) => console.log(`    ${cyan(x)}`));
      console.log(`\n  ${dim("ideamart reference <name>")}\n`);
    });
  }
  const content = readReference(doc);
  if (!content) fail(`Reference "${doc}" not found.`);
  console.log(content);
}

function cmdPlatform() {
  const data = {
    platform: catalog.platform,
    operators: catalog.operators,
    baseUrls: catalog.baseUrls,
    conventions: catalog.conventions,
  };
  out(data, (d) => {
    console.log(`\n  ${bold(d.platform.name)} — ${d.platform.operator}, ${d.platform.market}\n`);
    console.log(`  ${bold("Operators")}`);
    d.operators.forEach((o) => console.log(`    ${o.name.padEnd(10)} ${dim(o.prefixes.join(", "))}`));
    console.log(`\n  ${bold("Base URLs")}`);
    console.log(`    primary   ${cyan(d.baseUrls.primary)}`);
    console.log(`    alias     ${dim(d.baseUrls.alias)}`);
    console.log(`    LBS       ${dim(d.baseUrls.lbs)}`);
    console.log(`    egress IP ${dim(d.baseUrls.myIp)}  ${dim("(run on the calling server)")}`);
    console.log(`\n  ${bold("Addressing")}  ${d.conventions.addressing.format}`);
    d.conventions.addressing.rules.forEach((r) => console.log(`    ${dim("·")} ${dim(r)}`));
    console.log(`\n  ${red(bold("Critical"))}  ${d.conventions.responseEnvelope.criticalNote}`);
    console.log(`\n  ${bold("Support")}  ${d.platform.support.email}  ·  WhatsApp ${d.platform.support.whatsapp}\n`);
  });
}

/**
 * Emit ready-to-paste implementation code, generated from the catalog.
 *
 *   codegen <service|callback|client|errors|types|config|callbacks> --lang=<x>
 *
 * --out=<dir> writes the file instead of printing it.
 */
function cmdCodegen() {
  const positional = rest.filter((a) => !a.startsWith("--"));
  const flag = (name) => {
    const hit = rest.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };

  const target = positional[0] || "client";
  const language = flag("lang") || positional[1];

  if (!language) {
    return fail("Pick a language: --lang=" + Object.keys(LANGUAGES).join("|"), {
      languages: Object.keys(LANGUAGES),
      targets: TARGETS,
    });
  }

  let result;
  try {
    result = generate(target, language);
  } catch (err) {
    return fail(err.message, { languages: Object.keys(LANGUAGES), targets: TARGETS });
  }

  const outDir = flag("out");
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, result.filename);
    writeFileSync(path, result.code);
    return out({ ...result, path, code: undefined }, () =>
      console.log(`\n  ${green("wrote")} ${path}  ${dim(`(${result.language}, ${result.target})`)}\n`)
    );
  }

  if (JSON_MODE) return out(result);
  console.log(result.code);
}

function cmdHelp() {
  console.log(`
  ${bold("ideamart")} — offline reference for the Ideamart API ${dim(`(catalog v${catalog.catalogVersion})`)}

  ${bold("USAGE")}
    node tools/ideamart.mjs <command> [args] [--json]

  ${bold("DISCOVER")}
    list [category] [--direction=outbound|inbound]   List services and callbacks
    search <query>                                   Search everything
    show <id>                                        Full contract for one service
    platform                                         Base URLs, operators, conventions

  ${bold("BUILD")}
    curl <id> [key=value ...]                        Build a runnable request
    validate <id> <json|@file|->                     Check a payload against the spec
    codegen <what> --lang=<language> [--out=<dir>]   Emit ready-to-paste code

      what      client | errors | types | config | callbacks
                or one service/callback id (e.g. caas-direct-debit, ussd-receive)
      language  typescript | python | java | go | php | csharp

  ${bold("DEBUG")}
    code <statusCode>                                Decode a status code
    diagnose "<symptom>"                             Most likely cause and fix

  ${bold("GUIDANCE")}
    practices [critical|high|medium]                 Security and reliability rules
    checklist                                        Go-live checklist
    reference [doc]                                  Print a reference document

  ${bold("EXAMPLES")}
    ${dim("$")} node tools/ideamart.mjs list subscription
    ${dim("$")} node tools/ideamart.mjs show unsub
    ${dim("$")} node tools/ideamart.mjs search "base size"
    ${dim("$")} node tools/ideamart.mjs code E1303
    ${dim("$")} node tools/ideamart.mjs diagnose "callbacks never arrive"
    ${dim("$")} node tools/ideamart.mjs curl sms-send destinationAddresses='["tel:94771234567"]' message="Hi"
    ${dim("$")} node tools/ideamart.mjs validate sms-send '{"message":"hi","destinationAddresses":"tel:94771234567"}'
    ${dim("$")} node tools/ideamart.mjs codegen caas-direct-debit --lang=python
    ${dim("$")} node tools/ideamart.mjs codegen errors --lang=java
    ${dim("$")} node tools/ideamart.mjs codegen client --lang=go --out=./internal/ideamart

  ${dim("Add --json to any command for machine-readable output.")}
  ${dim("Offline and read-only: no network calls, and it never sees your credentials.")}
`);
}

/* ── Dispatch ────────────────────────────────────────────────────────────── */

function indent(s, n) {
  const pad = " ".repeat(n);
  return s.split("\n").map((l) => pad + l).join("\n");
}

const COMMANDS = {
  list: cmdList,
  ls: cmdList,
  show: cmdShow,
  get: cmdShow,
  code: cmdCode,
  status: cmdCode,
  diagnose: cmdDiagnose,
  debug: cmdDiagnose,
  search: cmdSearch,
  find: cmdSearch,
  curl: cmdCurl,
  build: cmdCurl,
  validate: cmdValidate,
  check: cmdValidate,
  codegen: cmdCodegen,
  generate: cmdCodegen,
  gen: cmdCodegen,
  practices: cmdPractices,
  checklist: cmdChecklist,
  reference: cmdReference,
  docs: cmdReference,
  platform: cmdPlatform,
  info: cmdPlatform,
  help: cmdHelp,
};

const handler = COMMANDS[command];
if (!command || command === "--help" || command === "-h") {
  cmdHelp();
} else if (!handler) {
  fail(`Unknown command "${command}". Run \`ideamart help\`.`, {
    commands: [...new Set(Object.keys(COMMANDS))],
  });
} else {
  handler();
}
