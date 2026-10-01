#!/usr/bin/env node
// Frontend i18n coverage audit — the gate for the Amharic sweep.
//
// Scans the client surfaces (app, lib, context, worker) for user-facing English
// that is still hardcoded: JSX text, the attributes a user or a screen reader
// reads (placeholder/title/aria-label/alt/label), object-literal labels, string
// returns and strings passed to a toast/alert/error path.
//
// Usage
//   node scripts/i18n-audit.mjs                   summary per module
//   node scripts/i18n-audit.mjs --all             list every dirty file
//   node scripts/i18n-audit.mjs --list            every match: file:line: [kind] text
//   node scripts/i18n-audit.mjs --file app/dashboard/sales/page.tsx
//   node scripts/i18n-audit.mjs --dir app/dashboard/manufacturing
//   node scripts/i18n-audit.mjs --strict          exit 1 if anything is left
//
// Deliberately biased to over-report: a false positive costs one glance, a
// false negative ships English. Silence a good line with `// i18n-ignore`
// (on the line itself or on the line above it).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const AREAS = ["app", "lib", "context", "worker"];
const SKIP_DIRS = new Set(["node_modules", ".next", "public", "dist", "locales"]);

// Names, units and acronyms that stay as they are (docs/i18n-glossary.md).
const ALLOW = new Set([
  "SKU", "ETB", "PDF", "CSV", "QR", "AI", "ID", "URL", "POS", "OTP", "PIN",
  "COGS", "App", "Amharic", "English", "Noto Sans Ethiopic", "Kass Inv.",
]);

const KINDS = {
  attr: /\b(placeholder|title|aria-label|alt|label|summary)=["']([^"'{}]{3,})["']/g,
  prop: /\b(title|label|name|text|description|message|placeholder|tooltip|heading|subtitle|ariaLabel)\s*:\s*["'`]([^"'`{}]{3,})["'`]/g,
  call: /\b(toast|alert|confirm|setError|setMessage|notify|showToast)\(\s*["']([^"'{}]{3,})["']/g,
  err: /throw new Error\(\s*["'`]([^"'`{}]{3,})["'`]/g,
  ret: /return\s+["']([^"']{3,})["']\s*;/g,
  jsx: /(?<!=)>\s*([A-Za-z][^<>{}]{2,}?)\s*</g,
  // Standalone JSX text line. Deliberately excludes ( ) = ; : so that code
  // lines such as `Array.isArray(body) ? rows.length : …` are not read as prose.
  bare: /^\s*([A-Z][A-Za-z0-9 ,'’&.!%+*#/-]{2,})\s*$/g,
  str: /^\s*["']([A-Za-z][^"']{2,})["'],?\s*$/g,
  // `?? "Fallback message"` and `: "Label"` — error text and inline defaults.
  fallback: /(?:\?\?|:)\s*["']([A-Z][^"'{}]{3,})["']/g,
};

// JSX text that `jsx`/`bare` miss: typographic punctuation (em dashes, slashes)
// and multi-line prose. Inline segments are read permissively because they sit
// between a real `>` and `<`; a tagless continuation line only counts when it
// looks like prose, which keeps code lines (quantity: 1, setSaleItems() …) out.
const TEXT_REGION = /(?<![=!])>([^<>]*)</g;
const EXPRESSION = /[{}"';`]|=>|==/;
// A tagless line only reads as JSX prose when it starts like prose (not with the
// `?`/`:` of a wrapped ternary), carries no string/expression punctuation, and
// ends on a word — so `sum +` or `? r.isOwner` stay out.
const PROSE_START = /^[\p{L}\p{N}+*[(—–]/u;
const PROSE_CONTINUATION = /^[\p{L}\p{N} ,.!?%+*#/&'’—–()[\]+-]+$/u;
// Statement keywords and `foo(` call syntax are code, not JSX prose.
const CODE_START =
  /^(?:if|for|while|return|await|const|let|var|new|else|switch|case|catch|typeof|function|import|export|throw|yield|do)\b/;
const CALL_SYNTAX = /[\p{L}\p{N}_$]\(/u;
// A line that follows `(`/`{`/`,`/`=>`/`=`/`:` continues a JS expression, not prose.
const AFTER_EXPR = /(?:[{(,\[]|=>|=|:)\s*$/;

function scanJsxText(lines, hits) {
  let inText = false;
  let inComment = false;
  lines.forEach((raw, i) => {
    // JSDoc/block comments (`* prose`, `/* … */`) are documentation, not UI text.
    if (inComment) {
      if (raw.includes("*/")) inComment = false;
      return;
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//")) return;
    if (/i18n-ignore/.test(raw) || /i18n-ignore/.test(lines[i - 1] ?? "")) return;
    if (trimmed.startsWith("/*") || trimmed.startsWith("{/*")) {
      if (!trimmed.includes("*/")) inComment = true;
      return;
    }
    if (inText && !/[<>]/.test(raw)) {
      const last = trimmed.split(/\s+/).pop() ?? "";
      const prev = (lines[i - 1] ?? "").trim();
      if (
        trimmed.includes(" ") &&
        PROSE_START.test(trimmed) &&
        PROSE_CONTINUATION.test(trimmed) &&
        !EXPRESSION.test(trimmed) &&
        !CODE_START.test(trimmed) &&
        !CALL_SYNTAX.test(trimmed) &&
        !AFTER_EXPR.test(prev) &&
        /\p{L}/u.test(last) &&
        keep(trimmed)
      ) {
        hits.push({ line: i + 1, kind: "jtext", text: trimmed });
      }
      return;
    }
    // Inline block comments can carry stray `<`/`>`; drop them before reading tags.
    const code = raw.replace(/\/\*.*?\*\//g, " ");
    TEXT_REGION.lastIndex = 0;
    let m;
    while ((m = TEXT_REGION.exec(code)) !== null) {
      const seg = m[1].trim();
      if (seg && !EXPRESSION.test(seg) && keep(seg)) {
        hits.push({ line: i + 1, kind: "jtext", text: seg });
      }
    }
    inText = raw.lastIndexOf(">") > raw.lastIndexOf("<");
    if (!inComment && !/\/\*.*\*\//.test(raw) && raw.includes("/*")) inComment = true;
  });
}

// Every pattern must be global: exec() ignores lastIndex otherwise and the
// scan loop below spins on the same match forever.
for (const [kind, re] of Object.entries(KINDS)) {
  if (!re.global) throw new Error(`KINDS.${kind} must use the /g flag`);
}

// Catalog keys referenced from code (segment names, key arrays) are not UI text.
function catalogKeys(node, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) catalogKeys(v, key, out);
    else out.add(key);
  }
  return out;
}
const EN_KEYS = catalogKeys(
  JSON.parse(readFileSync(new URL("../lib/locales/en/common.json", import.meta.url), "utf8")),
);

function keep(text) {
  const s = text.trim().replace(/\s+/g, " ");
  if (s.length < 3 || !/[A-Za-z]/.test(s)) return false;
  if (ALLOW.has(s)) return false;
  if (EN_KEYS.has(s)) return false; // an i18n key, not a literal
  if (/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/.test(s)) return false; // key shape
  if (/^[A-Z0-9_ /-]+$/.test(s)) return false; // enum values, acronyms
  if (s.includes("://") || s.startsWith("/") || s.startsWith(".")) return false;
  if (/^[^@\s]+@[^@\s]+$/.test(s)) return false; // email / handle
  if (/#[0-9a-fA-F]{3,8}\b/.test(s)) return false; // colours
  if (/^(https?|mailto|tel):/.test(s)) return false;
  if (/^[a-z][A-Za-z0-9_.-]*$/.test(s)) return false; // identifiers, css tokens
  if (/^[a-z]+(?:-[a-z]+)+$/.test(s)) return false; // kebab tokens
  if (/=>|\?\?|\?\.|&&|\|\|/.test(s)) return false; // JS operators, never prose
  return true;
}

// Trim a line at its comment marker, respecting quotes so `https://` survives.
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q && line[i - 1] !== "\\") q = null;
    } else if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function scanLine(line) {
  const found = new Map();
  for (const [kind, re] of Object.entries(KINDS)) {
    re.lastIndex = 0;
    let m;
    let guard = 0;
    while ((m = re.exec(line)) !== null) {
      const text = (m[2] ?? m[1] ?? "").trim();
      if (keep(text)) found.set(`${kind}:${text}`, { kind, text });
      if (m.index === re.lastIndex) re.lastIndex++;
      if (++guard > 500) break; // belt and braces
    }
  }
  return [...found.values()];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

function scanFile(abs) {
  const lines = readFileSync(abs, "utf8").split("\n");
  const hits = [];
  let inBlock = false;
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return;
    }
    if (/^\/\*/.test(trimmed)) {
      if (!trimmed.includes("*/")) inBlock = true;
      return;
    }
    if (!trimmed || /^\/\//.test(trimmed) || trimmed.startsWith("{/*")) return;
    if (/i18n-ignore/.test(raw) || /i18n-ignore/.test(lines[i - 1] ?? "")) return;
    const code = stripComment(raw);
    // Already localized, or pure plumbing.
    if (/\B(t|i18n\.t|statusLabel|fmtCurrency|fmtNumber|formatDate|formatDateTime|timeAgo)\(/.test(code)) return;
    if (/^\s*(import|export|interface|type|enum|declare)\b/.test(code)) return;
    for (const hit of scanLine(code)) hits.push({ line: i + 1, ...hit });
  });
  scanJsxText(lines, hits);
  // One hit per line per distinct string: `jsx`/`bare`/`jtext` all read the same
  // text, and a module total should not count it three times.
  const seen = new Set();
  return hits.filter((h) => {
    const id = `${h.line}:${h.text}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function moduleOf(rel) {
  const p = rel.split("/");
  if (p[0] !== "app") return p[0];
  if (p[1] === "components") return p.length > 3 ? `app/components/${p[2]}` : "app/components";
  if (p[1] === "dashboard") return p.length > 3 ? `app/dashboard/${p[2]}` : "app/dashboard";
  return `app/${p[1] ?? ""}`;
}

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? null : argv[i + 1];
};

const files = [];
for (const area of AREAS) {
  const dir = join(ROOT, area);
  try {
    statSync(dir);
  } catch {
    continue; // area not present in this checkout
  }
  files.push(...walk(dir));
}

const only = value("--file") ?? value("--dir");
const results = [];
for (const abs of files) {
  const rel = relative(ROOT, abs);
  if (only && !rel.startsWith(only)) continue;
  results.push({ rel, hits: scanFile(abs) });
}
results.sort((a, b) => b.hits.length - a.hits.length);

const dirty = results.filter((r) => r.hits.length > 0);
const total = dirty.reduce((s, r) => s + r.hits.length, 0);
const scope = only ? ` (scope: ${only})` : "";

if (flag("--list")) {
  for (const r of dirty) {
    for (const h of r.hits) console.log(`${r.rel}:${h.line}: [${h.kind}] ${h.text}`);
  }
  console.log(`\n${dirty.length} dirty / ${results.length} scanned — ${total} hits${scope}`);
} else {
  const byModule = new Map();
  for (const r of dirty) {
    const key = moduleOf(r.rel);
    const cur = byModule.get(key) ?? { hits: 0, files: 0 };
    cur.hits += r.hits.length;
    cur.files += 1;
    byModule.set(key, cur);
  }
  console.log(
    `Frontend i18n audit — ${results.length} files scanned, ${dirty.length} dirty, ${total} hits${scope}`,
  );
  console.log("---- per module (hits, files) ----");
  for (const [mod, v] of [...byModule].sort((a, b) => b[1].hits - a[1].hits)) {
    console.log(String(v.hits).padStart(5), String(v.files).padStart(4), mod);
  }
  console.log("---- files ----");
  for (const r of flag("--all") ? dirty : dirty.slice(0, 40)) {
    console.log(String(r.hits.length).padStart(5), r.rel);
  }
  if (!flag("--all") && dirty.length > 40) console.log(`      … ${dirty.length - 40} more (--all)`);
}
if (flag("--strict") && total > 0) process.exit(1);

