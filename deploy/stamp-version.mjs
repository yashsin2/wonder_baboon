#!/usr/bin/env node
/**
 * Bumps ?v= on HTML asset URLs, ES module imports in js/, and writes version.json.
 * Run after `npm run build` and before uploading frontend/ to Hostinger.
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTEND = join(ROOT, "frontend");

function getVersion() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return (
      String(d.getFullYear()) +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      pad(d.getHours()) +
      pad(d.getMinutes())
    );
  }
}

function stampHtml(content, version) {
  let out = content.replace(/\?v=[^"'\s>]+/g, `?v=${version}`);
  out = out.replace(
    /((?:href|src)=["'])((?:\.\/|\.\.\/|\/)(?!\/)(?:[^"']+\.(?:css|js)))(["'])/gi,
    `$1$2?v=${version}$3`,
  );
  return out;
}

function stampJsImports(content, version) {
  return content.replace(
    /from\s+["'](\.\/[^"']+\.js)(?:\?v=[^"']*)?["']/g,
    `from "$1?v=${version}"`,
  );
}

const version = getVersion();
let htmlCount = 0;
let jsCount = 0;

for (const name of readdirSync(FRONTEND).filter((f) => f.endsWith(".html"))) {
  const path = join(FRONTEND, name);
  const stamped = stampHtml(readFileSync(path, "utf8"), version);
  writeFileSync(path, stamped);
  htmlCount++;
}

const jsDir = join(FRONTEND, "js");
for (const name of readdirSync(jsDir).filter((f) => f.endsWith(".js"))) {
  const path = join(jsDir, name);
  const stamped = stampJsImports(readFileSync(path, "utf8"), version);
  writeFileSync(path, stamped);
  jsCount++;
}

writeFileSync(
  join(FRONTEND, "version.json"),
  JSON.stringify({ v: version }, null, 2) + "\n",
);

console.log(`Stamped ${htmlCount} HTML + ${jsCount} JS files with v=${version}`);
console.log(`Wrote frontend/version.json`);
