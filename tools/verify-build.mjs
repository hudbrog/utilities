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
  "dist/curriculum-review.json",
];

await Promise.all(requiredFiles.map((path) => access(path)));

const [indexHtml, manifestSource, reviewPackageSource] = await Promise.all([
  readFile("dist/index.html", "utf8"),
  readFile("dist/manifest.webmanifest", "utf8"),
  readFile("dist/curriculum-review.json", "utf8"),
]);
const manifest = JSON.parse(manifestSource);
const reviewPackage = JSON.parse(reviewPackageSource);

if (reviewPackage.schemaVersion !== 1 || !reviewPackage.sourceFingerprint) {
  throw new Error("Curriculum review package has an unsupported schema or no source fingerprint");
}
if (!Array.isArray(reviewPackage.units) || reviewPackage.units.length === 0 || !Array.isArray(reviewPackage.proposals) || reviewPackage.proposals.length === 0) {
  throw new Error("Curriculum review package must contain units and proposals");
}
const proposalIds = new Set(reviewPackage.proposals.map(({ conceptId }) => conceptId));
const packagedConceptIds = reviewPackage.units.flatMap(({ conceptIds }) => conceptIds);
if (proposalIds.size !== reviewPackage.proposals.length || packagedConceptIds.length !== proposalIds.size || packagedConceptIds.some((id) => !proposalIds.has(id))) {
  throw new Error("Curriculum review package concept IDs are duplicated, missing, or unreferenced");
}
if (reviewPackage.units.some(({ reviewFingerprint }) => !reviewFingerprint)) {
  throw new Error("Every curriculum review unit must have a review fingerprint");
}

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

console.log(`Verified ${requiredFiles.length} required files, ${rootRelativeUrls.length} root-relative URLs, and ${proposalIds.size} curriculum proposals.`);
