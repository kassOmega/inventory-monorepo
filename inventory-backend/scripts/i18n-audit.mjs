#!/usr/bin/env node
// Backend i18n coverage audit — the gate for the Amharic sweep.
//
// Reports every `throw new *Exception(...)` under src/ whose message does not
// go through tr()/translate(), split into two kinds:
//   static       — a plain string literal. Cataloging it is enough: the
//                  LocalizedExceptionFilter reverse-maps exact English text to
//                  the request locale at the HTTP edge.
//   interpolated — a template literal with ${...}. The filter cannot match
//                  dynamic text, so these must become tr("errors.x", { ... }).
//
// Usage
//   node scripts/i18n-audit.mjs            per-module summary
//   node scripts/i18n-audit.mjs --list     every unconverted site
//   node scripts/i18n-audit.mjs --all      list every module, however small
//   node scripts/i18n-audit.mjs --strict   exit 1 if anything is left
//
// Sites that are already localized are counted too, so the two numbers always
// add up to the total number of throw statements.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "src");
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", "generated"]);

// A localized site calls one of the i18n helpers inside the throw expression.
const LOCALIZED = /\b(tr|translate|localizedMessage|i18n\.t)\(/;
const THROW = /throw new (\w*Exception)\(/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

function moduleOf(rel) {
  const p = rel.split("/");
  return p[1] ?? "(root)";
}

export function auditBackend() {
  const sites = [];
  for (const abs of walk(SRC)) {
    const rel = relative(ROOT, abs);
    if (/\.(spec|test)\.ts$/.test(rel)) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = THROW.exec(line);
      if (!m) return;
      // The message usually sits on the same line, but multi-line throws are
      // common: look ahead until the argument list closes.
      const blob = lines.slice(i, i + 5).join(" ").split(/\)\s*;/)[0];
      const localized = LOCALIZED.test(blob);
      const interpolated = blob.includes("${") || blob.includes("+ ");
      sites.push({
        file: rel,
        line: i + 1,
        kind: localized ? "localized" : interpolated ? "interpolated" : "static",
        exception: m[1],
        module: moduleOf(rel),
      });
    });
  }
  return sites;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(n);
  const sites = auditBackend();
  const dirty = sites.filter((s) => s.kind !== "localized");
  const total = sites.length;
  const localized = sites.filter((s) => s.kind === "localized").length;
  const interp = dirty.filter((s) => s.kind === "interpolated").length;

  console.log(
    `Backend i18n audit — ${total} throw sites, ${localized} localized, ` +
      `${dirty.length} remaining (${dirty.length - interp} static, ${interp} interpolated)`,
  );

  if (flag("--list")) {
    for (const s of dirty.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`${s.file}:${s.line}: [${s.kind}] ${s.exception}`);
    }
  } else {
    const byModule = new Map();
    for (const s of dirty) {
      const cur = byModule.get(s.module) ?? { static: 0, interpolated: 0 };
      cur[s.kind] += 1;
      byModule.set(s.module, cur);
    }
    console.log("---- per module (static, interpolated, total) ----");
    const rows = [...byModule].sort((a, b) => b[1].static + b[1].interpolated - (a[1].static + a[1].interpolated));
    for (const [mod, v] of flag("--all") ? rows : rows.slice(0, 40)) {
      console.log(String(v.static).padStart(5), String(v.interpolated).padStart(5), String(v.static + v.interpolated).padStart(5), mod);
    }
  }
  if (flag("--strict") && dirty.length > 0) process.exit(1);
}
