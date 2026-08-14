#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "dist/index.html",
  "dist/manifest.webmanifest",
  "dist/sw.js",
  "dist/icons/icon-192.png",
  "dist/icons/icon-512.png",
  "dist/icons/maskable-512.png",
  "dist/icons/apple-touch-icon.png",
  "dist/legacy/math-trainer.html",
];

await Promise.all(requiredFiles.map((path) => access(path)));

const [indexHtml, manifestSource] = await Promise.all([
  readFile("dist/index.html", "utf8"),
  readFile("dist/manifest.webmanifest", "utf8"),
]);
const manifest = JSON.parse(manifestSource);

for (const field of ["id", "start_url", "scope"]) {
  if (!String(manifest[field]).startsWith("/utilities/")) {
    throw new Error(`manifest.${field} must be rooted at /utilities/: ${manifest[field]}`);
  }
}

for (const icon of manifest.icons ?? []) {
  if (!String(icon.src).startsWith("/utilities/")) {
    throw new Error(`Manifest icon escaped the GitHub Pages base: ${icon.src}`);
  }
}

const rootRelativeUrls = [...indexHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((match) => match[1]);
const escapedUrls = rootRelativeUrls.filter((url) => !url.startsWith("/utilities/"));
if (escapedUrls.length > 0) throw new Error(`Build contains URLs outside /utilities/: ${escapedUrls.join(", ")}`);

console.log(`Verified ${requiredFiles.length} required files and ${rootRelativeUrls.length} root-relative URLs.`);
