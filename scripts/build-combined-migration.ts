#!/usr/bin/env npx tsx
/* Build an idempotent combined migration file for paste into Supabase SQL Editor. */

import fs from "fs";
import path from "path";

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let out = "-- Henri App — Combined Migration (idempotent v6)\n\n";

let addedDrops = 0;

for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  const lines = sql.split("\n");
  const outLines: string[] = [];
  let inDoBlock = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track DO $$ ... END $$; depth
    const doMatches = (trimmed.match(/^DO\s+\$\$/gi) || []).length;
    inDoBlock += doMatches;
    const endMatches = (trimmed.match(/END\s+\$\$\s*;/gi) || []).length;
    inDoBlock = Math.max(0, inDoBlock - endMatches);

    // Match CREATE POLICY where name is on this line OR where ON <table> is up to 5 lines away
    const nameMatch = trimmed.match(/^CREATE\s+POLICY\s+("[^"]+"|\w+)\s*(.*)$/i);
    if (inDoBlock === 0 && nameMatch) {
      // Look for ON <table> on this line or following lines (up to 5)
      const name = nameMatch[1];
      let rest = nameMatch[2] || "";
      for (let j = 1; j <= 5 && !/\bON\s+[\w.]+/i.test(rest); j++) {
        if (i + j < lines.length) rest += " " + lines[i + j];
      }
      const onMatch = rest.match(/\bON\s+([\w.]+)/i);
      if (onMatch) {
        const indent = line.match(/^\s*/)?.[0] ?? "";
        outLines.push(`${indent}DROP POLICY IF EXISTS ${name} ON ${onMatch[1]};`);
        addedDrops++;
      }
    }
    outLines.push(line);
  }
  out += `\n-- === ${f} ===\n${outLines.join("\n")}\n`;
}

fs.writeFileSync(path.join(process.cwd(), "supabase", "combined-migrations.sql"), out);
console.log(`Wrote ${out.length} bytes with ${addedDrops} inline DROPs added`);
