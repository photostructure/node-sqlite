#!/usr/bin/env node

// Asserts a minimum npm version before a job resolves or publishes anything.
//
// npm only honors `min-release-age` (see .npmrc) as of 11.10, and only supports
// `npm stage publish` as of 11.15. Older npm parses the setting, warns once, and
// installs the newest release anyway -- so the floor has to be asserted, not
// assumed.
//
// This runs before `npm ci` at every call site, and inside `node:*-alpine`
// containers, so it must stay dependency-free and use only bare-node APIs.
// That is why it is .mjs rather than .ts: tsx is not installed yet.

import { execFileSync } from "node:child_process";

const required = process.argv[2];
if (required == null) {
  console.error("Usage: node scripts/verify-npm-version.mjs <min-version>");
  process.exit(2);
}

/** @returns {[number, number, number]} */
function parse(version, label) {
  // Matches the leading three segments and ignores any prerelease or build
  // suffix, so "12.0.0-pre.1" parses as 12.0.0. Segments are bounded and the
  // match is unanchored at the end because a trailing `(?:[-+].*)?$` group
  // trips eslint's ReDoS heuristic for no real benefit.
  const match = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})/.exec(version);
  if (match == null) {
    console.error(`::error::Unparsable ${label} npm version: ${version}`);
    process.exit(2);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Windows resolves npm through npm.cmd, which execFile cannot run directly.
const actual = execFileSync("npm", ["--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
}).trim();

const [reqMajor, reqMinor, reqPatch] = parse(required, "required");
const [major, minor, patch] = parse(actual, "installed");

const satisfied =
  major > reqMajor ||
  (major === reqMajor &&
    (minor > reqMinor || (minor === reqMinor && patch >= reqPatch)));

if (!satisfied) {
  console.error(
    `::error::npm ${required} or later is required here, but this toolchain has ${actual}. ` +
      `Pin node-version to a Node.js release that bundles npm ${required} or later.`,
  );
  process.exit(1);
}

console.log(`npm ${actual} satisfies the ${required} floor`);
