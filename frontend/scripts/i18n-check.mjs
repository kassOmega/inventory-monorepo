#!/usr/bin/env node
// Catalog gates for the Amharic sweep. Run after every batch; all three must be
// clean before a batch is considered done.
//
//   1. parity    — en and am must have exactly the same key set.
//   2. identical — an am value that equals its en value is almost always a miss.
//                  The allowlist below is for the strings we keep in Latin on
//                  purpose (docs/i18n-glossary.md → "Kept in Latin").
//   3. glossary  — rows of docs/i18n-glossary.md marked `yes` in the Enforce
//                  column must not use an avoided variant in the am value.
//
// Usage
//   node scripts/i18n-check.mjs           all three gates
//   node scripts/i18n-check.mjs --json    machine-readable result
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const EN = `${ROOT}lib/locales/en/common.json`;
const AM = `${ROOT}lib/locales/am/common.json`;
const GLOSSARY = `${ROOT}../docs/i18n-glossary.md`;

// am === en is correct for these keys. Every entry needs a reason.
const ALLOW_IDENTICAL = {
  "app.name": "product name, never transliterated",
  "app.nameFull": "product name, never transliterated",
  "assist.supportEmail": "an email placeholder",
  "language.english": "a language is named in its own script",
  "sales.scannedBumped": "digits and placeholders only — nothing to translate",
  "taxes.agentUrlPh": "a placeholder URL",
  "taxes.morLiveUrlPh": "a placeholder URL",
  // The PDF stacks (pdfkit / jspdf) cannot embed an Ethiopic font yet, so the
  // price-list and QR-sheet documents stay Latin until Phase 5 removes this.
  "products.sku": "SKU",
  "products.qr": "QR",
  "products.priceList.docTitle": "PDF string, Phase 5",
  "products.priceList.generatedOn": "PDF string, Phase 5",
  "products.priceList.item": "PDF string, Phase 5",
  "products.priceList.price": "PDF string, Phase 5",
  "products.priceList.footer": "PDF string, Phase 5",
  "products.priceList.phoneLabel": "PDF string, Phase 5",
  "products.priceList.contactLabel": "PDF string, Phase 5",
  "products.qrSheet.docTitle": "PDF string, Phase 5",
  "products.qrSheet.barcodeLabel": "PDF string, Phase 5",
  "pdm.colSku": "SKU",
  "mfg.catalog.skuLabel": "SKU",
  "mfg.catalog.mediaPlaceholder": "a placeholder URL",
};

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

const en = flatten(JSON.parse(readFileSync(EN, "utf8")));
const am = flatten(JSON.parse(readFileSync(AM, "utf8")));

const parity = {
  missingInAm: [...en.keys()].filter((k) => !am.has(k)),
  extraInAm: [...am.keys()].filter((k) => !en.has(k)),
};

const identical = [];
for (const [key, value] of en) {
  if (typeof value !== "string" || typeof am.get(key) !== "string") continue;
  if (value !== am.get(key)) continue;
  if (ALLOW_IDENTICAL[key]) continue;
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
  console.log(`Frontend catalog check — ${en.size} en keys, ${am.size} am keys`);
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
