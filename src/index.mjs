#!/usr/bin/env node
/**
 * Ozow MCP server.
 *
 * Exposes the Ozow One API (South African instant EFT) as MCP tools, locked to
 * the staging environment unless production is explicitly and separately
 * unlocked. See README.md for the safety model.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, ConfigError, mask, CONFIRM_PHRASE } from "./config.mjs";
import { OzowClient, OzowError } from "./ozow.mjs";
import {
  GuardError, checkAmount, checkLiveConfirmation, checkUrl,
  expiryFromMinutes, checkBeneficiaryReference,
} from "./guards.mjs";

// stdout belongs to the MCP transport. Anything written there corrupts the
// protocol, so every diagnostic goes to stderr.
const log = (...args) => console.error("[ozow-mcp]", ...args);

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    log(`Configuration error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const client = new OzowClient(config);
const banner = config.env.real ? "PRODUCTION - REAL MONEY" : "staging (no real money)";
log(`starting against ${config.env.api}  [${banner}]`);

const server = new McpServer({ name: "ozow", version: "0.1.0" });

/** Render a tool result, turning known failures into readable text. */
const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

function handle(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      if (e instanceof GuardError) return fail(`Refused: ${e.message}`);
      if (e instanceof OzowError) {
        return fail(`Ozow API error: ${e.message}\n${JSON.stringify(e.body ?? {}, null, 2)}`);
      }
      return fail(`Unexpected error: ${e.message}`);
    }
  };
}

server.registerTool(
  "ozow_environment",
  {
    title: "Show Ozow environment",
    description:
      "Report which Ozow environment this server is connected to, whether it can move " +
      "real money, and the configured limits. Call this first - and always before any " +
      "payment - so you know whether you are in staging or production.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handle(async () => ok({
    environment: config.env.name,
    movesRealMoney: config.env.real,
    apiBaseUrl: config.env.api,
    dashboard: config.env.dashboard,
    siteCode: config.siteCode,
    clientId: mask(config.clientId),
    maxAmountZar: config.maxAmount,
    confirmationRequiredForPayments: config.env.real,
  })),
);

server.registerTool(
  "ozow_verify_credentials",
  {
    title: "Verify Ozow credentials",
    description:
      "Check that the configured client ID and secret can obtain an access token. " +
      "Makes no changes and moves no money.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handle(async () => {
    await client.verifyCredentials();
    return ok({ valid: true, environment: config.env.name, scope: config.scope });
  }),
);

server.registerTool(
  "ozow_create_payment",
  {
    title: "Create an Ozow payment request",
    description:
      "Create a payment request and return a redirectUrl for the payer to complete in " +
      "their bank. In production this collects REAL money and requires explicit " +
      "confirmation from the human you are working for - never supply the confirmation " +
      "phrase on your own initiative. Amounts are in rands.",
    inputSchema: {
      amount: z.number().positive().describe("Amount in ZAR, e.g. 149.99"),
      merchantReference: z.string().min(1).max(50)
        .describe("Your own order reference"),
      returnUrl: z.string().url()
        .describe("https URL the payer returns to after paying"),
      beneficiaryReference: z.string().optional()
        .describe("Letters and numbers only, max 20. Shown on the bank statement."),
      notifyUrl: z.string().url().optional()
        .describe("https URL for the server-to-server notification"),
      expiresInMinutes: z.number().int().optional()
        .describe("How long the request stays valid. Default 30, max 1440."),
      confirm: z.string().optional()
        .describe(`Required in production only. Must be exactly "${CONFIRM_PHRASE}".`),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  handle(async (a) => {
    checkLiveConfirmation(config.env, a.confirm);
    checkAmount(a.amount, config.maxAmount);

    const payment = await client.createPayment({
      amount: a.amount,
      merchantReference: a.merchantReference,
      beneficiaryReference: checkBeneficiaryReference(a.beneficiaryReference),
      returnUrl: checkUrl(a.returnUrl, "returnUrl"),
      notifyUrl: a.notifyUrl ? checkUrl(a.notifyUrl, "notifyUrl") : undefined,
      expireAt: expiryFromMinutes(a.expiresInMinutes ?? 30),
    });

    return ok({
      environment: config.env.name,
      movesRealMoney: config.env.real,
      id: payment?.id,
      status: payment?.status,
      redirectUrl: payment?.redirectUrl,
      links: payment?.links,
    });
  }),
);

server.registerTool(
  "ozow_get_transactions",
  {
    title: "List transactions for a payment",
    description:
      "List the transactions recorded against a payment request, to check whether it " +
      "was paid. Read-only.",
    inputSchema: {
      paymentId: z.string().min(1).describe("The payment id returned by ozow_create_payment"),
      fromDate: z.string().optional().describe("ISO date, defaults to 7 days ago"),
      toDate: z.string().optional().describe("ISO date, defaults to now"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handle(async (a) => {
    const toDate = a.toDate ?? new Date().toISOString();
    const fromDate = a.fromDate ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
    return ok(await client.listTransactions(a.paymentId, { fromDate, toDate }));
  }),
);

server.registerTool(
  "ozow_cancel_payment",
  {
    title: "Cancel an Ozow payment request",
    description:
      "Cancel a payment request that has not been completed. Irreversible: the payer " +
      "can no longer use that link.",
    inputSchema: {
      paymentId: z.string().min(1).describe("The payment id to cancel"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  handle(async (a) => ok(await client.cancelPayment(a.paymentId))),
);

await server.connect(new StdioServerTransport());
log("ready");
