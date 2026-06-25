#!/usr/bin/env node

import { readFileSync, unlinkSync } from "node:fs";

const passphraseFile = process.env.BRANCH_PURGE_SSH_PASSPHRASE_FILE;
const prompt = process.argv.slice(2).join(" ");

if (passphraseFile) {
  try {
    const passphrase = readFileSync(passphraseFile, "utf8");
    process.stdout.write(`${passphrase}\n`);
  } finally {
    // Consume-and-delete: shrink the window the secret exists on disk.
    try {
      unlinkSync(passphraseFile);
    } catch {
      // already gone / racing cleanup — nothing to do
    }
  }
  process.exit(0);
}

const encodedPrompt = Buffer.from(prompt, "utf8").toString("base64");
process.stderr.write(`BRANCH_PURGE_ASKPASS_PROMPT:${encodedPrompt}\n`);
process.exit(1);
