#!/usr/bin/env node
/**
 * `npm run check` - validate configuration and, if credentials are present,
 * confirm they can obtain a token. Safe to run at any time: it moves no money.
 */
import { loadConfig, ConfigError, mask } from "./config.mjs";
import { OzowClient } from "./ozow.mjs";

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`\n  FAIL  ${e.message}\n`);
    process.exitCode = 1;
  } else {
    throw e;
  }
}

if (config) {
  const line = (label, value) => console.log(`  ${label.padEnd(16)} ${value}`);

  console.log("\nOzow MCP preflight\n");
  line("environment", config.env.name + (config.env.real ? "   *** REAL MONEY ***" : ""));
  line("api", config.env.api);
  line("auth", config.env.auth);
  line("site code", config.siteCode);
  line("client id", mask(config.clientId));
  line("client secret", mask(config.clientSecret));
  line("max amount", `R${config.maxAmount}`);
  line("confirmation", config.env.real ? "required for payments" : "not required in staging");

  // Resolve the check fully before printing, and never call process.exit()
  // here: tearing the process down right after a fetch trips a libuv
  // assertion on Windows. Setting exitCode lets the loop drain cleanly.
  let failure = null;
  try {
    await new OzowClient(config).verifyCredentials();
  } catch (e) {
    failure = e.message;
  }

  if (failure) {
    line("credentials", "FAILED");
    console.log(`\n  ${failure}\n`);
    process.exitCode = 1;
  } else {
    line("credentials", "ok");
    console.log();
  }
}
