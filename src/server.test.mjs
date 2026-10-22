/**
 * End-to-end test: spawn the real server over stdio and speak MCP to it.
 * No Ozow credentials are needed - these tests exercise the tool surface and
 * the guards, which reject before any network call is made.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PRODUCTION_ACK, CONFIRM_PHRASE } from "./config.mjs";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "index.mjs");

const CREDS = {
  OZOW_CLIENT_ID: "test-client",
  OZOW_CLIENT_SECRET: "test-secret",
  OZOW_SITE_CODE: "ABC-DEF-123",
};

async function connect(env = {}) {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [ENTRY],
      env: { ...CREDS, ...env, PATH: process.env.PATH ?? "" },
      stderr: "ignore",
    }),
  );
  return client;
}

const textOf = (r) => r.content.map((c) => c.text).join("\n");

test("server starts and advertises its tools", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();

  assert.deepEqual(names, [
    "ozow_cancel_payment",
    "ozow_create_payment",
    "ozow_environment",
    "ozow_get_transactions",
    "ozow_verify_credentials",
  ]);
  await client.close();
});

test("read-only tools are annotated as such, payment tools are not", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  assert.equal(byName.ozow_environment.annotations.readOnlyHint, true);
  assert.equal(byName.ozow_get_transactions.annotations.readOnlyHint, true);
  assert.equal(byName.ozow_create_payment.annotations.readOnlyHint, false);
  assert.equal(byName.ozow_create_payment.annotations.destructiveHint, true);
  assert.equal(byName.ozow_cancel_payment.annotations.destructiveHint, true);
  await client.close();
});

test("defaults to staging and says so", async () => {
  const client = await connect();
  const res = await client.callTool({ name: "ozow_environment", arguments: {} });
  const env = JSON.parse(textOf(res));

  assert.equal(env.environment, "staging");
  assert.equal(env.movesRealMoney, false);
  assert.match(env.apiBaseUrl, /stagingone\.ozow\.com/);
  assert.equal(env.confirmationRequiredForPayments, false);
  await client.close();
});

test("the environment tool never leaks the client secret", async () => {
  const client = await connect();
  const body = textOf(await client.callTool({ name: "ozow_environment", arguments: {} }));

  assert.ok(!body.includes("test-secret"), "secret must not appear in output");
  assert.ok(!body.includes("test-client"), "full client id must not appear in output");
  await client.close();
});

test("an over-ceiling amount is refused before any network call", async () => {
  const client = await connect({ OZOW_MAX_AMOUNT: "100" });
  const res = await client.callTool({
    name: "ozow_create_payment",
    arguments: {
      amount: 5000,
      merchantReference: "TEST-1",
      returnUrl: "https://shop.example.com/done",
    },
  });

  assert.equal(res.isError, true);
  assert.match(textOf(res), /exceeds the ceiling of R100/);
  await client.close();
});

test("a non-https return URL is refused", async () => {
  const client = await connect();
  const res = await client.callTool({
    name: "ozow_create_payment",
    arguments: {
      amount: 10,
      merchantReference: "TEST-2",
      returnUrl: "http://shop.example.com/done",
    },
  });

  assert.equal(res.isError, true);
  assert.match(textOf(res), /https/);
  await client.close();
});

test("production without confirmation is refused at the tool boundary", async () => {
  const client = await connect({
    OZOW_ENV: "production",
    OZOW_ALLOW_PRODUCTION: PRODUCTION_ACK,
  });

  const env = JSON.parse(textOf(await client.callTool({ name: "ozow_environment", arguments: {} })));
  assert.equal(env.movesRealMoney, true);
  assert.equal(env.confirmationRequiredForPayments, true);

  const res = await client.callTool({
    name: "ozow_create_payment",
    arguments: {
      amount: 10,
      merchantReference: "TEST-3",
      returnUrl: "https://shop.example.com/done",
    },
  });

  assert.equal(res.isError, true);
  assert.match(textOf(res), /PRODUCTION/);
  assert.match(textOf(res), /ask the human first/);
  await client.close();
});

test("asking for production without acknowledging it kills the server", async () => {
  await assert.rejects(
    () => connect({ OZOW_ENV: "production" }),
    "server must refuse to start, not fall back to staging",
  );
});
