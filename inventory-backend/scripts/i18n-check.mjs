#!/usr/bin/env node
// Backend catalog gates — the mirror of frontend/scripts/i18n-check.mjs.
//
//   1. parity    — en and am must have exactly the same key set.
//   2. identical — an am value that equals its en value is almost always a miss.
//                  The allowlist below is for strings we keep in Latin on
//                  purpose (docs/i18n-glossary.md → "Kept in Latin").
//   3. glossary  — rows of docs/i18n-glossary.md marked `yes` in the Enforce
//                  column must not use an avoided variant in the am value.
//
// Usage
//   node scripts/i18n-check.mjs           all three gates
//   node scripts/i18n-check.mjs --json    machine-readable result
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const EN = `${ROOT}src/i18n/backend.en.ts`;
const AM = `${ROOT}src/i18n/backend.am.ts`;
const GLOSSARY = `${ROOT}../docs/i18n-glossary.md`;

// am === en is correct for these keys. Every entry needs a reason.
const ALLOW_IDENTICAL = {
  "errors.agentMode": "AUTONOMOUS / ADVISORY are protocol enum values",
};

// A whole subtree that stays Latin on purpose (same rule, keyed by prefix so the
// reason is written once). Every entry needs a reason.
const ALLOW_IDENTICAL_PREFIX = {};

// The catalogs are plain object literals (no template literals, spreads or calls),
// so they can be read without booting TypeScript.
function loadCatalog(path) {
  const src = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const body = src.slice(src.indexOf("{", src.indexOf("=")), src.lastIndexOf("}") + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${body});`)();
}

function flatten(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function glossaryRows() {
  const md = readFileSync(GLOSSARY, "utf8");
  const rows = [];
  for (const line of md.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(yes|no)\s*\|/.exec(line);
    if (!m) continue;
    const [, en, canonical, avoid, enforce] = m;
    if (en === "English") continue; // header row
    rows.push({
      en: en.trim(),
      canonical: canonical.trim(),
      avoid: avoid.split(",").map((s) => s.trim()).filter((s) => s && s !== "—"),
      enforce: enforce.trim() === "yes",
    });
  }
  return rows;
}

// Does the English value refer to this glossary term as a whole word?
function mentions(enValue, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`, "i").test(enValue);
}

const en = flatten(loadCatalog(EN));
const am = flatten(loadCatalog(AM));

const parity = {
  missingInAm: [...en.keys()].filter((k) => !am.has(k)),
  extraInAm: [...am.keys()].filter((k) => !en.has(k)),
};

const allowedIdentical = (key) =>
  Boolean(ALLOW_IDENTICAL[key]) ||
  Object.keys(ALLOW_IDENTICAL_PREFIX).some((p) => key.startsWith(p));

const identical = [];
for (const [key, value] of en) {
  if (typeof value !== "string" || typeof am.get(key) !== "string") continue;
  if (value !== am.get(key)) continue;
  if (allowedIdentical(key)) continue;
  if (!/[A-Za-z]/.test(value)) continue; // no Latin to translate
  identical.push({ key, value });
}
const staleAllowlist = Object.keys(ALLOW_IDENTICAL).filter(
  (key) => en.get(key) !== am.get(key),
);

const glossary = [];
for (const row of glossaryRows().filter((r) => r.enforce)) {
  for (const [key, enValue] of en) {
    if (typeof enValue !== "string" || !mentions(enValue, row.en)) continue;
    const amValue = am.get(key);
    if (typeof amValue !== "string") continue;
    for (const bad of row.avoid) {
      if (amValue.includes(bad)) {
        glossary.push({ key, en: enValue, am: amValue, term: row.en, avoid: bad });
      }
    }
  }
}

const failures =
  parity.missingInAm.length + parity.extraInAm.length + identical.length + glossary.length;

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ parity, identical, glossary, failures }, null, 2));
} else {
  console.log(`Backend catalog check — ${en.size} en keys, ${am.size} am keys`);
  console.log(
    `1. parity      ${parity.missingInAm.length + parity.extraInAm.length === 0 ? "OK" : "FAIL"}`,
  );
  parity.missingInAm.forEach((k) => console.log(`     missing in am: ${k}`));
  parity.extraInAm.forEach((k) => console.log(`     extra in am:   ${k}`));
  console.log(`2. identical   ${identical.length === 0 ? "OK" : `${identical.length} untranslated`}`);
  identical.forEach((i) => console.log(`     ${i.key} = "${i.value}"`));
  staleAllowlist.forEach((k) => console.log(`     stale allowlist entry (now translated): ${k}`));
  console.log(`3. glossary    ${glossary.length === 0 ? "OK" : `${glossary.length} violations`}`);
  glossary.forEach((g) =>
    console.log(`     ${g.key}: "${g.en}" → "${g.am}" uses avoided "${g.avoid}" for ${g.term}`),
  );
  console.log(failures === 0 ? "\nAll gates clean." : `\n${failures} failure(s).`);
}

if (failures > 0) process.exit(1);
