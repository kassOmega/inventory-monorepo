// Sanity check that Button renders a spinner + disables when loading.
// Plain script (no frontend test runner): npx tsx lib/button.check.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Button from "../app/components/Button";

const idle = renderToStaticMarkup(<Button>Save</Button>);
const busy = renderToStaticMarkup(<Button loading>Save</Button>);
const off = renderToStaticMarkup(<Button disabled>Save</Button>);

let fail = 0;
const check = (c: boolean, m: string) => { if (!c) { fail++; console.error("FAIL:", m); } };
check(!idle.includes("animate-spin"), "idle has no spinner");
check(busy.includes("animate-spin"), "busy shows spinner");
check(busy.includes("disabled"), "busy is disabled");
check(busy.includes("aria-busy"), "busy sets aria-busy");
check(busy.includes("Save"), "busy keeps the action label");
check(off.includes("disabled"), "disabled prop honored");
check(idle.includes("bg-blue-600"), "primary theme preserved");
if (fail) { console.error(`${fail} button check(s) failed`); process.exit(1); }
console.log("Button: all checks passed");
