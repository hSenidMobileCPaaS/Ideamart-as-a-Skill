import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../tools/catalog.mjs";

const read = (p) => readFileSync(join(repoRoot, p), "utf8");
const readJson = (p) => JSON.parse(read(p));

/* ── Manifests ───────────────────────────────────────────────────────────── */

const MANIFESTS = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  ".qoder-plugin/plugin.json",
  "gemini-extension.json",
  "opencode.json",
  "package.json",
];

test("every manifest is valid JSON", () => {
  for (const m of MANIFESTS) {
    assert.doesNotThrow(() => readJson(m), `${m} is not valid JSON`);
  }
});

test("plugin manifests agree on name and version", () => {
  const version = readJson("package.json").version;
  for (const m of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".qoder-plugin/plugin.json", "gemini-extension.json"]) {
    const manifest = readJson(m);
    assert.equal(manifest.name, "ideamart", `${m} has the wrong name`);
    assert.equal(manifest.version, version, `${m} version drifted from package.json`);
  }
});

test("plugin.yaml lists every skill that exists on disk", () => {
  const yaml = read("plugin.yaml");
  const onDisk = readdirSync(join(repoRoot, "skills")).sort();
  for (const skill of onDisk) {
    assert.ok(yaml.includes(`- ${skill}`), `plugin.yaml does not list skill "${skill}"`);
  }
});

/* ── Skills ──────────────────────────────────────────────────────────────── */

test("every skill has valid frontmatter with a name matching its directory", () => {
  const dirs = readdirSync(join(repoRoot, "skills"));
  assert.ok(dirs.length >= 7, `expected at least 7 skills, found ${dirs.length}`);

  for (const dir of dirs) {
    const path = `skills/${dir}/SKILL.md`;
    assert.ok(existsSync(join(repoRoot, path)), `${dir} has no SKILL.md`);

    const content = read(path);
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(fm, `${path} has no frontmatter`);

    const name = fm[1].match(/^name:\s*(.+)$/m);
    const description = fm[1].match(/^description:\s*(.+)$/m);
    assert.ok(name, `${path} frontmatter has no name`);
    assert.ok(description, `${path} frontmatter has no description`);
    assert.equal(name[1].trim(), dir, `${path} name does not match its directory`);
    assert.ok(
      description[1].trim().length > 40,
      `${path} description is too short to route on`
    );
  }
});

test("the root SKILL.md has frontmatter", () => {
  const fm = read("SKILL.md").match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, "SKILL.md has no frontmatter");
  assert.match(fm[1], /^name:\s*ideamart\s*$/m);
  assert.match(fm[1], /^description:\s*.+/m);
});

/* ── Commands ────────────────────────────────────────────────────────────── */

test("every skill has a matching slash command", () => {
  const skills = readdirSync(join(repoRoot, "skills"));
  for (const skill of skills) {
    const path = `commands/${skill}.toml`;
    assert.ok(existsSync(join(repoRoot, path)), `missing command for skill "${skill}"`);
    const content = read(path);
    assert.match(content, /^description = ".+"$/m, `${path} has no description`);
    assert.match(content, /^prompt = ".+"$/m, `${path} has no prompt`);
  }
});

/* ── Agent rule copies ───────────────────────────────────────────────────── */

test("agent rule copies are in sync with AGENTS.md", () => {
  const result = execFileSync("node", ["scripts/sync-rules.mjs", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.match(result, /in sync/);
});

test("every generated rule copy exists and carries the banner", () => {
  const copies = [
    ".agents/rules/ideamart.md",
    ".windsurf/rules/ideamart.md",
    ".clinerules/ideamart.md",
    ".kiro/steering/ideamart.md",
    ".qoder/rules/ideamart.md",
    ".cursor/rules/ideamart.mdc",
    ".github/copilot-instructions.md",
  ];
  for (const copy of copies) {
    assert.ok(existsSync(join(repoRoot, copy)), `missing ${copy}`);
    assert.match(read(copy), /Generated from AGENTS\.md/, `${copy} has no generated banner`);
  }
});

test("the Cursor rule keeps its .mdc frontmatter", () => {
  assert.match(read(".cursor/rules/ideamart.mdc"), /^---\ndescription:.*\n[\s\S]*?\n---/);
});

/* ── Governance and assets ───────────────────────────────────────────────── */

test("governance files exist", () => {
  for (const f of ["LICENSE", "README.md", "CONTRIBUTING.md", "SECURITY.md", "docs/agent-support.md"]) {
    assert.ok(existsSync(join(repoRoot, f)), `missing ${f}`);
  }
});

test("assets exist and are well-formed SVG", () => {
  for (const f of ["assets/logo.svg", "assets/logo-dark.svg", "assets/architecture.svg", "assets/social-preview.svg"]) {
    const svg = read(f);
    assert.match(svg, /^<svg[\s>]/m, `${f} does not start with an <svg> element`);
    assert.match(svg, /<\/svg>\s*$/, `${f} is not closed`);
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${f} has no xmlns`);
    assert.match(svg, /role="img"|aria-label=/, `${f} has no accessible label`);
  }
});

test("every asset referenced by the README exists", () => {
  const readme = read("README.md");
  for (const [, src] of readme.matchAll(/(?:src|srcset)="(assets\/[^"]+)"/g)) {
    assert.ok(existsSync(join(repoRoot, src)), `README references missing asset ${src}`);
  }
});

test("every relative link in the README points at something real", () => {
  const readme = read("README.md");
  const missing = [];
  for (const [, target] of readme.matchAll(/\]\((?!https?:|#)([^)]+)\)/g)) {
    const clean = target.split("#")[0];
    if (clean && !existsSync(join(repoRoot, clean))) missing.push(clean);
  }
  assert.deepEqual(missing, [], `README links to missing paths: ${missing.join(", ")}`);
});

/* ── CLI ─────────────────────────────────────────────────────────────────── */

const cli = (...args) =>
  execFileSync("node", ["tools/ideamart.mjs", ...args], { cwd: repoRoot, encoding: "utf8" });

test("the CLI responds to every documented command", () => {
  assert.doesNotThrow(() => cli("help"));
  assert.doesNotThrow(() => cli("list", "--json"));
  assert.doesNotThrow(() => cli("show", "sms-send", "--json"));
  assert.doesNotThrow(() => cli("search", "base size", "--json"));
  assert.doesNotThrow(() => cli("code", "E1303", "--json"));
  assert.doesNotThrow(() => cli("diagnose", "callbacks never arrive", "--json"));
  assert.doesNotThrow(() => cli("curl", "subscription-query-base", "--json"));
  assert.doesNotThrow(() => cli("practices", "--json"));
  assert.doesNotThrow(() => cli("checklist", "--json"));
  assert.doesNotThrow(() => cli("platform", "--json"));
  assert.doesNotThrow(() => cli("reference", "--json"));
});

test("the CLI emits parseable JSON with --json", () => {
  const listed = JSON.parse(cli("list", "--json"));
  assert.ok(listed.count >= 14, `expected at least 14 entries, got ${listed.count}`);
  assert.equal(JSON.parse(cli("code", "E1379", "--json")).class, "success");
  assert.ok(JSON.parse(cli("checklist", "--json")).count > 50);
});

test("built requests never leak a credential", () => {
  const built = JSON.parse(cli("curl", "caas-direct-debit", "--json"));
  assert.equal(built.payload.applicationId, "$IDEAMART_APP_ID");
  assert.equal(built.payload.password, "$IDEAMART_PASSWORD");
  assert.ok(built.curl.includes("$IDEAMART_APP_ID"));
});

test("the CLI exits non-zero on an invalid payload", () => {
  assert.throws(
    () => cli("validate", "sms-send", '{"message":"hi","destinationAddresses":"tel:94771234567"}'),
    /Command failed|status/
  );
});

test("the CLI fails clearly on an unknown service", () => {
  assert.throws(() => cli("show", "not-a-real-service"));
});
