/**
 * Policy guards, kept pure and separate from the network client so they can be
 * tested without credentials. Every money-moving path runs through these.
 */
import { CONFIRM_PHRASE } from "./config.mjs";

export class GuardError extends Error {}

/**
 * Reject an amount that is malformed, non-positive, or over the configured
 * ceiling. The ceiling exists because an agent that miscounts a zero should
 * hit a wall rather than a bank.
 */
export function checkAmount(amount, maxAmount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new GuardError("Amount must be a number of rands, for example 10.50.");
  }
  if (amount <= 0) throw new GuardError("Amount must be greater than zero.");
  if (Math.round(amount * 100) !== amount * 100) {
    throw new GuardError("Amount cannot be finer than one cent.");
  }
  if (amount > maxAmount) {
    throw new GuardError(
      `Amount R${amount} exceeds the ceiling of R${maxAmount}. ` +
        `Raise OZOW_MAX_AMOUNT deliberately if this is intended.`,
    );
  }
  return amount;
}

/**
 * In staging, money is imaginary, so confirmation friction teaches nothing and
 * trains people to click through. In production, require the exact phrase.
 */
export function checkLiveConfirmation(environment, confirm) {
  if (!environment.real) return;
  if (confirm !== CONFIRM_PHRASE) {
    throw new GuardError(
      `This server is pointed at PRODUCTION and this call moves real money. ` +
        `Pass confirm="${CONFIRM_PHRASE}" to proceed. ` +
        `Do not do this on the model's own initiative - ask the human first.`,
    );
  }
}

/** Reject a return URL that is not a plain https:// address. */
export function checkUrl(url, field) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuardError(`${field} must be a valid absolute URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new GuardError(`${field} must use https, got "${parsed.protocol}".`);
  }
  return parsed.toString();
}

/** Ozow wants RFC 3339. Build it from a minutes-from-now offset. */
export function expiryFromMinutes(minutes = 30) {
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
    throw new GuardError("expiresInMinutes must be between 1 and 1440.");
  }
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Ozow requires letters and numbers only for the beneficiary reference. */
export function checkBeneficiaryReference(ref) {
  if (ref == null) return undefined;
  if (!/^[A-Za-z0-9]{1,20}$/.test(ref)) {
    throw new GuardError(
      "beneficiaryReference must be 1-20 letters and numbers only, no spaces or punctuation.",
    );
  }
  return ref;
}
