import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkAmount, checkLiveConfirmation, checkUrl, expiryFromMinutes,
  checkBeneficiaryReference, GuardError,
} from "./guards.mjs";
import { loadConfig, ConfigError, ENVIRONMENTS, PRODUCTION_ACK, CONFIRM_PHRASE, mask } from "./config.mjs";

const baseEnv = {
  OZOW_CLIENT_ID: "client-abc",
  OZOW_CLIENT_SECRET: "secret-xyz",
  OZOW_SITE_CODE: "ABC-DEF-123",
};

test("defaults to staging when nothing is set", () => {
  const c = loadConfig(baseEnv);
  assert.equal(c.env.name, "staging");
  assert.equal(c.env.real, false);
  assert.match(c.env.api, /stagingone\.ozow\.com/);
});

test("production without the acknowledgement refuses to start", () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, OZOW_ENV: "production" }),
    (e) => e instanceof ConfigError && /OZOW_ALLOW_PRODUCTION/.test(e.message),
  );
});

test("production never silently downgrades to staging", () => {
  // The dangerous failure is believing you are live when you are not, or the
  // reverse. Either way the server must refuse rather than guess.
  assert.throws(() => loadConfig({ ...baseEnv, OZOW_ENV: "production", OZOW_ALLOW_PRODUCTION: "yes" }), ConfigError);
  const c = loadConfig({ ...baseEnv, OZOW_ENV: "production", OZOW_ALLOW_PRODUCTION: PRODUCTION_ACK });
  assert.equal(c.env.real, true);
  assert.match(c.env.api, /^https:\/\/one\.ozow\.com$/);
});

test("an unknown environment is rejected, not coerced", () => {
  assert.throws(() => loadConfig({ ...baseEnv, OZOW_ENV: "prod" }), ConfigError);
  assert.throws(() => loadConfig({ ...baseEnv, OZOW_ENV: "" }), ConfigError);
});

test("staging and production are different hosts", () => {
  assert.notEqual(ENVIRONMENTS.staging.api, ENVIRONMENTS.production.api);
  assert.notEqual(ENVIRONMENTS.staging.auth, ENVIRONMENTS.production.auth);
});

test("tokens come from the auth host, not the API host", () => {
  for (const env of Object.values(ENVIRONMENTS)) {
    assert.ok(env.auth.endsWith("/token"), `${env.name} auth must be a /token URL`);
    assert.ok(!env.auth.startsWith(env.api), `${env.name} auth must not sit under the API host`);
  }
});

test("missing or malformed credentials are rejected", () => {
  assert.throws(() => loadConfig({ ...baseEnv, OZOW_CLIENT_ID: "" }), /OZOW_CLIENT_ID/);
  assert.throws(() => loadConfig({ ...baseEnv, OZOW_SITE_CODE: "nope" }), /XXX-XXX-XXX/);
});

test("amount ceiling holds", () => {
  assert.equal(checkAmount(10.5, 1000), 10.5);
  assert.throws(() => checkAmount(1000.01, 1000), GuardError);
  assert.throws(() => checkAmount(0, 1000), GuardError);
  assert.throws(() => checkAmount(-5, 1000), GuardError);
  assert.throws(() => checkAmount("10", 1000), GuardError);
  assert.throws(() => checkAmount(NaN, 1000), GuardError);
  assert.throws(() => checkAmount(1.005, 1000), /one cent/);
});

test("staging needs no confirmation, production needs the exact phrase", () => {
  assert.doesNotThrow(() => checkLiveConfirmation(ENVIRONMENTS.staging, undefined));
  assert.throws(() => checkLiveConfirmation(ENVIRONMENTS.production, undefined), GuardError);
  assert.throws(() => checkLiveConfirmation(ENVIRONMENTS.production, "yes"), GuardError);
  assert.throws(() => checkLiveConfirmation(ENVIRONMENTS.production, CONFIRM_PHRASE.toLowerCase()), GuardError);
  assert.doesNotThrow(() => checkLiveConfirmation(ENVIRONMENTS.production, CONFIRM_PHRASE));
});

test("only https URLs are accepted", () => {
  assert.equal(checkUrl("https://shop.example.com/done", "returnUrl"), "https://shop.example.com/done");
  assert.throws(() => checkUrl("http://shop.example.com", "returnUrl"), /https/);
  assert.throws(() => checkUrl("javascript:alert(1)", "returnUrl"), /https/);
  assert.throws(() => checkUrl("not a url", "returnUrl"), /valid absolute URL/);
});

test("beneficiary reference is letters and numbers only", () => {
  assert.equal(checkBeneficiaryReference("INV001"), "INV001");
  assert.equal(checkBeneficiaryReference(undefined), undefined);
  assert.throws(() => checkBeneficiaryReference("INV 001"), GuardError);
  assert.throws(() => checkBeneficiaryReference("INV-001"), GuardError);
  assert.throws(() => checkBeneficiaryReference("x".repeat(21)), GuardError);
});

test("expiry is RFC 3339 and bounded", () => {
  const iso = expiryFromMinutes(30);
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.ok(new Date(iso).getTime() > Date.now());
  assert.throws(() => expiryFromMinutes(0), GuardError);
  assert.throws(() => expiryFromMinutes(1441), GuardError);
});

test("mask never reveals a whole secret", () => {
  assert.equal(mask(""), "unset");
  assert.equal(mask("short"), "*****");
  const m = mask("abcdefghijklmnop");
  assert.ok(!m.includes("efghijklmn"));
  assert.match(m, /^abcd\.\.\.op$/);
});
