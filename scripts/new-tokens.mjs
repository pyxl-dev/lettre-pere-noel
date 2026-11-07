#!/usr/bin/env node
// Génère deux jetons secrets (un par personne) et les liens personnels correspondants.
// Usage : node scripts/new-tokens.mjs [https://noel.example.org]
import { randomBytes } from "node:crypto";

const base = (process.argv[2] || "https://noel.nizrod.ovh").replace(/\/$/, "");
for (const p of ["A", "B"]) {
  const t = randomBytes(24).toString("base64url");
  console.log(`PERSON_${p}_TOKEN=${t}`);
  console.log(`  lien : ${base}/#t=${t}`);
}
