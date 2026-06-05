#!/usr/bin/env node
/**
 * Seam guard - the mechanical CI check that fails (exit 1) if a mandated paikko
 * seam is bypassed.
 *
 * Why it exists
 * -------------
 * The architecture only stays total if EVERY API handler is wrapped, EVERY bit
 * of app/domain client state lives in the one mandated store, and the build-time
 * provenance injection is never stripped. A prompt will hold that line for a few
 * tickets; it will not hold it over 50. This script holds it instead. It is dumb
 * and binary ON PURPOSE: it does not judge whether a fix is correct (that's the
 * LLM verify-agent's job) - it only judges whether a seam was bypassed. Pure
 * mechanics, no taste.
 *
 * Three rules, three seams (the router seam is the agent's responsibility and is
 * not mechanically checkable in v0 without a real router to grep for, so it is
 * intentionally out of scope here):
 *
 *   1. api-handlers-wrapped
 *      Every `app/api/**​/route.ts` that exports an HTTP method handler
 *      (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) must route that handler through
 *      `withCapture(...)`. We require BOTH:
 *        - the file imports `withCapture` (so the capture seam is actually the
 *          one being used, not a local shadow), and
 *        - every exported method handler's value is a `withCapture(...)` call.
 *      Bare `export async function GET()` or `export const GET = async () => {}`
 *      is a violation: a raw handler escapes capture.
 *
 *   2. state-in-store
 *      Client app/domain state must live in the one mandated zustand store
 *      (the `create(...)` from "zustand", expected under src/lib/store or a
 *      file named *store*). A SECOND zustand store, a Redux store, or a React
 *      Context being used as an app-state container is flagged. We deliberately
 *      do NOT flag local `useState`/`useReducer` - component-local UI state is
 *      allowed and expected; only rival GLOBAL stores are the bypass.
 *      Heuristics (kept deliberately simple, over-flagging is acceptable for v0):
 *        - more than one `create(...)` call sourced from "zustand"/"zustand/*"
 *          across the tree  -> violation (a second store).
 *        - any import from "redux", "@reduxjs/toolkit", "react-redux",
 *          "jotai", "recoil", "valtio", "mobx", "mobx-react*", "xstate"
 *          (rival global-state libs)  -> violation.
 *        - `createContext(` whose value is then fed a `useReducer`/`useState`
 *          in the SAME file (context-as-store smell)  -> violation.
 *      None of these inspect runtime behaviour; they are text smells. False
 *      positives are tolerated and documented: if a flag is wrong, the fix is to
 *      move the state into the mandated store, which is the point.
 *
 *   3. provenance-present
 *      The build-time `data-src` injection must be wired and not stripped. We
 *      pass if EITHER:
 *        - next.config.(js|mjs|ts) declares the provenance SWC plugin under
 *          `experimental.swcPlugins` (a non-commented entry whose name matches
 *          /provenance/), OR
 *        - a `.babelrc`(.json)/`babel.config.*` at the repo root references a
 *          plugin whose name matches /provenance/.
 *      A commented-out stub (the foundation default) does NOT count - that's the
 *      "stripped" state. Exactly one of the two paths is expected (see
 *      PROVENANCE.md); we only require at least one.
 *
 * Output contract
 * ---------------
 * - No violations -> prints "seam-guard: all seams intact." and exits 0.
 * - Violations    -> prints each as "[rule] file: message" and exits 1.
 * - Internal crash-> exits 2 (distinct from a clean fail so CI can tell them
 *   apart).
 *
 * No dependencies. Node >= 18 (uses fs/path/url only; recursive readdir).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/* ------------------------------------------------------------------ */
/* tiny fs helpers (no deps)                                          */
/* ------------------------------------------------------------------ */

const IGNORE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "out",
  "coverage",
]);

/** Recursively walk `dir`, yielding absolute file paths, skipping IGNORE_DIRS. */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".babelrc") {
      // skip dotfiles/dirs generally, but we still want to see .babelrc* later
      // (handled explicitly in the provenance rule, not via walk)
      if (e.isDirectory()) continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function read(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function rel(file) {
  return relative(ROOT, file);
}

/**
 * Strip line (`//`) and block (`/* *​/`) comments so heuristics don't trip on
 * commented-out code. Deliberately naive (no string/regex awareness); good
 * enough for the smell-level checks below and documented as such.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SOURCE_EXT = /\.(t|j)sx?$/;

function allSourceFiles() {
  return walk(ROOT).filter((f) => SOURCE_EXT.test(f));
}

/* ------------------------------------------------------------------ */
/* Rule 1: api-handlers-wrapped                                       */
/* ------------------------------------------------------------------ */

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Is this absolute path an App-Router route handler? `app/api/**​/route.ts`. */
function isApiRoute(file) {
  const r = rel(file);
  return /(^|\/)app\/api\/.*\/route\.(t|j)sx?$/.test(r) || /(^|\/)app\/api\/route\.(t|j)sx?$/.test(r);
}

function ruleApiHandlersWrapped() {
  const violations = [];
  const routes = allSourceFiles().filter(isApiRoute);

  for (const file of routes) {
    const raw = read(file);
    const src = stripComments(raw);

    const importsWithCapture =
      /\bimport\b[\s\S]*?\bwithCapture\b[\s\S]*?\bfrom\b/.test(src) ||
      /\bwithCapture\b\s*=\s*require\(/.test(src);

    // Find every exported HTTP method handler and check its value is a
    // withCapture(...) call. Two export forms:
    //   export const GET = withCapture(...)
    //   export async function GET(...) {}   <- always a raw handler
    let foundAny = false;
    for (const m of HTTP_METHODS) {
      // function form -> inherently unwrapped
      const fnForm = new RegExp(
        `export\\s+(async\\s+)?function\\s+${m}\\b`,
      );
      if (fnForm.test(src)) {
        foundAny = true;
        violations.push({
          file: rel(file),
          message: `handler ${m} is a raw function export; wrap it in withCapture(...)`,
        });
        continue;
      }

      // const/let/var form -> capture the assigned expression
      const constForm = new RegExp(
        `export\\s+(?:const|let|var)\\s+${m}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?)(?:;|\\n)`,
      );
      const cm = constForm.exec(src);
      if (cm) {
        foundAny = true;
        const value = cm[1].trim();
        if (!/^withCapture\s*\(/.test(value)) {
          violations.push({
            file: rel(file),
            message: `handler ${m} is not wrapped in withCapture(...) (found: ${truncate(value)})`,
          });
        }
        continue;
      }

      // re-export form: export { GET } from "..." or export { x as GET }
      const reExport = new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`);
      if (reExport.test(src)) {
        foundAny = true;
        // Can't see the value through a re-export; require withCapture import as
        // a weak proxy and warn so it's visible but don't hard-trust it.
        if (!importsWithCapture) {
          violations.push({
            file: rel(file),
            message: `handler ${m} is re-exported and withCapture is not imported here; verify it is wrapped at the source`,
          });
        }
      }
    }

    if (foundAny && !importsWithCapture) {
      violations.push({
        file: rel(file),
        message:
          "route exports HTTP handlers but does not import withCapture; every handler must route through the capture seam",
      });
    }
  }

  return violations;
}

function truncate(s, n = 60) {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

/* ------------------------------------------------------------------ */
/* Rule 2: state-in-store                                             */
/* ------------------------------------------------------------------ */

const RIVAL_STATE_LIBS = [
  "redux",
  "@reduxjs/toolkit",
  "react-redux",
  "jotai",
  "recoil",
  "valtio",
  "mobx",
  "mobx-react",
  "mobx-react-lite",
  "xstate",
  "@xstate/react",
  "easy-peasy",
  "effector",
  "effector-react",
];

/** Does `file` import `create` from zustand (the mandated store factory)? */
function importsZustandCreate(src) {
  // import { create } from "zustand"  (also zustand/vanilla, zustand/...)
  const namedFrom = /import\s*\{[^}]*\bcreate\b[^}]*\}\s*from\s*["']zustand(?:\/[^"']+)?["']/;
  // import create from "zustand" (default) - some setups
  const defaultFrom = /import\s+create\s+from\s*["']zustand(?:\/[^"']+)?["']/;
  return namedFrom.test(src) || defaultFrom.test(src);
}

/** Count create(...) invocations in a file that uses the zustand create import. */
function countZustandStores(src) {
  if (!importsZustandCreate(src)) return 0;
  // create(...) or create<...>(...) - count call sites.
  const m = src.match(/\bcreate\s*(?:<[\s\S]*?>)?\s*\(/g);
  return m ? m.length : 0;
}

function ruleStateInStore() {
  const violations = [];
  const files = allSourceFiles().filter(
    (f) => !isApiRoute(f) && !rel(f).startsWith("scripts/"),
  );

  let totalZustandStores = 0;
  const storeFiles = [];

  for (const file of files) {
    const src = stripComments(read(file));

    // 2a: rival global-state libraries.
    for (const lib of RIVAL_STATE_LIBS) {
      const imp = new RegExp(
        `(?:import\\b[\\s\\S]*?from\\s*|require\\(\\s*)["']${escapeRe(lib)}(?:\\/[^"']+)?["']`,
      );
      if (imp.test(src)) {
        violations.push({
          file: rel(file),
          message: `imports rival state library "${lib}"; app/domain state must live in the mandated zustand store`,
        });
      }
    }

    // 2b: count zustand stores (a second one is a rival store).
    const n = countZustandStores(src);
    if (n > 0) {
      totalZustandStores += n;
      storeFiles.push({ file: rel(file), n });
    }

    // 2c: context-as-store smell: createContext + a reducer/state in the same
    // file. A context that merely passes config/theme is fine; one that wires a
    // useReducer/useState into its value is acting as a global store.
    if (
      /\bcreateContext\s*\(/.test(src) &&
      /\b(useReducer|useState)\s*\(/.test(src) &&
      /\.Provider\b/.test(src)
    ) {
      violations.push({
        file: rel(file),
        message:
          "createContext + useReducer/useState + Provider in one file looks like a context-as-store; move app/domain state into the mandated zustand store (false positive? keep config-only contexts out of state)",
      });
    }
  }

  // More than one zustand store anywhere = a rival store exists.
  if (totalZustandStores > 1) {
    for (const s of storeFiles) {
      violations.push({
        file: s.file,
        message: `${s.n} zustand store(s) here; total ${totalZustandStores} across the repo - exactly one mandated store is allowed`,
      });
    }
  }

  return violations;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ------------------------------------------------------------------ */
/* Rule 3: provenance-present                                         */
/* ------------------------------------------------------------------ */

function ruleProvenancePresent() {
  const violations = [];

  const nextConfigs = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs",
  ]
    .map((f) => join(ROOT, f))
    .filter(existsSync);

  const babelConfigs = [
    ".babelrc",
    ".babelrc.js",
    ".babelrc.json",
    ".babelrc.cjs",
    "babel.config.js",
    "babel.config.json",
    "babel.config.cjs",
    "babel.config.mjs",
  ]
    .map((f) => join(ROOT, f))
    .filter(existsSync);

  // SWC path: a non-commented swcPlugins entry whose name mentions provenance.
  let swcOk = false;
  for (const cfg of nextConfigs) {
    const src = stripComments(read(cfg));
    if (
      /swcPlugins\s*:/.test(src) &&
      /provenance/i.test(src) &&
      // make sure the provenance ref is inside a plugin array entry, not a stray
      // word: look for a string literal mentioning provenance.
      /["'][^"']*provenance[^"']*["']/i.test(src)
    ) {
      swcOk = true;
    }
  }

  // Babel path: any babel config referencing a provenance plugin.
  let babelOk = false;
  for (const cfg of babelConfigs) {
    const src = stripComments(read(cfg));
    if (/provenance/i.test(src) && /["'][^"']*provenance[^"']*["']/i.test(src)) {
      babelOk = true;
    }
  }

  if (!swcOk && !babelOk) {
    const where =
      nextConfigs.map(rel).join(", ") || "next.config.js";
    violations.push({
      file: where,
      message:
        "provenance plugin not wired: no active swcPlugins entry matching /provenance/ in next.config.* and no provenance plugin in any babel config. The build-time data-src injection is missing or stripped (a commented-out stub does not count).",
    });
  }

  return violations;
}

/* ------------------------------------------------------------------ */
/* runner                                                             */
/* ------------------------------------------------------------------ */

const rules = [
  { name: "api-handlers-wrapped", run: ruleApiHandlersWrapped },
  { name: "state-in-store", run: ruleStateInStore },
  { name: "provenance-present", run: ruleProvenancePresent },
];

function main() {
  const violations = [];
  for (const rule of rules) {
    let found = [];
    try {
      found = rule.run() || [];
    } catch (err) {
      console.error(`seam-guard: rule "${rule.name}" crashed`);
      console.error(err);
      process.exit(2);
    }
    for (const v of found) violations.push({ rule: rule.name, ...v });
  }

  if (violations.length > 0) {
    console.error(`seam-guard: ${violations.length} violation(s):\n`);
    for (const v of violations) {
      console.error(`  [${v.rule}] ${v.file ?? "?"}: ${v.message}`);
    }
    console.error(
      "\nseam-guard: FAIL - a mandated seam was bypassed. See scripts/seam-guard.mjs header for the heuristics.",
    );
    process.exit(1);
  }

  console.log("seam-guard: all seams intact. OK.");
  process.exit(0);
}

main();
