/**
 * Configuration and the production lock.
 *
 * The single most important property of this server: it talks to staging
 * unless someone has deliberately, explicitly and unambiguously said otherwise.
 * Ozow selects environment by BASE URL, not by a request flag, so the lock is
 * structural - a staging-configured server has no way to reach production.
 */

export const ENVIRONMENTS = {
  staging: {
    name: "staging",
    api: "https://stagingone.ozow.com",
    // Tokens come from a separate auth host, NOT from the API host. Ozow's
    // published quick-start shows <api>/v1/token, which 404s; both auth hosts
    // below were confirmed to answer client_credentials with OAuth2 errors.
    auth: "https://stagingauth.ozow.com/token",
    dashboard: "https://stagingdash.ozow.com",
    real: false,
  },
  production: {
    name: "production",
    api: "https://one.ozow.com",
    auth: "https://auth.ozow.com/token",
    dashboard: "https://dash.ozow.com",
    real: true,
  },
};

/** The exact string that must be set to unlock production. Deliberately awkward. */
export const PRODUCTION_ACK = "i-understand-this-moves-real-money";

/** Phrase a caller must pass to confirm a live payment, per call. */
export const CONFIRM_PHRASE = "CONFIRM LIVE PAYMENT";

/** Default ceiling, in rands, on any single payment request. */
export const DEFAULT_MAX_AMOUNT = 1000;

export class ConfigError extends Error {}

export function loadConfig(env = process.env) {
  const requested = (env.OZOW_ENV ?? "staging").toLowerCase().trim();

  if (!ENVIRONMENTS[requested]) {
    throw new ConfigError(
      `OZOW_ENV must be "staging" or "production", got "${requested}".`,
    );
  }

  const target = ENVIRONMENTS[requested];

  // Production is opt-in twice: the environment AND a separate acknowledgement.
  // A missing acknowledgement is a hard failure, never a silent downgrade -
  // an operator who thinks they are live and is not is in a worse position
  // than one who cannot start.
  if (target.real && env.OZOW_ALLOW_PRODUCTION !== PRODUCTION_ACK) {
    throw new ConfigError(
      `OZOW_ENV=production also requires OZOW_ALLOW_PRODUCTION="${PRODUCTION_ACK}". ` +
        `Refusing to start: production was asked for but not acknowledged.`,
    );
  }

  const missing = ["OZOW_CLIENT_ID", "OZOW_CLIENT_SECRET", "OZOW_SITE_CODE"]
    .filter((k) => !env[k]);
  if (missing.length) {
    throw new ConfigError(
      `Missing ${missing.join(", ")}. Get these from the Ozow portal ` +
        `(${target.dashboard}) under One API clients.`,
    );
  }

  const siteCode = env.OZOW_SITE_CODE.trim();
  if (!/^[A-Za-z0-9]{3}-[A-Za-z0-9]{3}-[A-Za-z0-9]{3}$/.test(siteCode)) {
    throw new ConfigError(`OZOW_SITE_CODE must look like XXX-XXX-XXX, got "${siteCode}".`);
  }

  const maxAmount = Number(env.OZOW_MAX_AMOUNT ?? DEFAULT_MAX_AMOUNT);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    throw new ConfigError(`OZOW_MAX_AMOUNT must be a positive number.`);
  }

  return {
    env: target,
    clientId: env.OZOW_CLIENT_ID.trim(),
    clientSecret: env.OZOW_CLIENT_SECRET.trim(),
    siteCode,
    maxAmount,
    scope: env.OZOW_SCOPE ?? "payments",
  };
}

/** Never print a secret. Show just enough to tell two credentials apart. */
export const mask = (s) =>
  !s ? "unset" : s.length <= 8 ? "*".repeat(s.length) : `${s.slice(0, 4)}...${s.slice(-2)}`;
