#!/usr/bin/env node
// Frontend i18n coverage heuristic audit.
//
// Scans app/**/*.{tsx,ts} (client surfaces) for lines that look like
// hardcoded user-facing English text still embedded in JSX:
//   - text nodes:     >Some words</  or >Some words{  (not {vars})
//   - attributes:     placeholder="...", title="...", aria-label="..."
//   - string returns: return "Some phrase";  (non-comment)
//
// It is intentionally heuristic (filters out className/keys/urls/emojis);
// run it after each module sweep. Lower numbers = more coverage.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const APP = join(ROOT, "app");

const SKIP_DIRS = new Set(["node_modules", ".next", "public"]);
const TEXT_NODE = /(>|\n)\s*([A-Za-z][A-Za-z ,'’&.?!:;()%+-]{2,})[<{]?/;
const ATTR_STRING =
  /\b(placeholder|title|aria-label|alt|label)="([A-Za-z][A-Za-z ,'’&.?!:;()%+*#-]{3,})"/;
const RETURN_STRING =
  /return\s+"([A-Za-z][A-Za-z ,'’&.?!:;()%+*#-]{3,})";/;

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

function hitCount(src) {
  // strip comments & pure-code zones roughly
  const lines = src.split("\n");
  let count = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    // ignore obvious non-translatable lines
    if (/className=|\.map\(|\.filter\(|=>|href=|key=|type=|<svg|<path|<option value/.test(line)) {
      // attributes can still appear on same line as text; keep scanning for text-node only when line also contains tag with text. Simplify: skip pure className/import/const lines.
      if (/^import |^const |className=|return \(|\)$/.test(line)) continue;
    }
    if (TEXT_NODE.test(line)) count++;
    if (ATTR_STRING.test(line)) count++;
    if (RETURN_STRING.test(line)) count++;
  }
  return count;
}

const files = walk(APP).map((p) => ({
  file: p.replace(ROOT, ""),
  hits: hitCount(readFileSync(p, "utf8")),
}));
files.sort((a, b) => b.hits - a.hits);
const total = files.reduce((s, f) => s + f.hits, 0);
console.log(`Files: ${files.length}   total heuristic hits: ${total}`);
console.log("---- top 40 ----");
for (const f of files.slice(0, 40)) {
  if (f.hits > 0) console.log(String(f.hits).padStart(4), f.file);
}
