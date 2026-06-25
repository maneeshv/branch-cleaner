#!/usr/bin/env node

const passphrase = process.env.BRANCH_PURGE_SSH_PASSPHRASE;
const prompt = process.argv.slice(2).join(" ");

if (passphrase !== undefined) {
  process.stdout.write(`${passphrase}\n`);
  process.exit(0);
}

const encodedPrompt = Buffer.from(prompt, "utf8").toString("base64");
process.stderr.write(`BRANCH_PURGE_ASKPASS_PROMPT:${encodedPrompt}\n`);
process.exit(1);
