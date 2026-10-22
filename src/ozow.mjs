/**
 * Ozow One API client.
 *
 * Endpoints (staging swaps the host, nothing else):
 *   POST <auth host>/token                client_credentials -> bearer
 *   POST /v1/payments                     create a payment request
 *   GET  /v1/payments/{id}/transactions   transactions for a payment
 *   POST /v1/payments/{id}/cancel         cancel a payment
 */

export class OzowError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export class OzowClient {
  #config;
  #token = null;
  #tokenExpiresAt = 0;

  constructor(config) {
    this.#config = config;
  }

  get environment() {
    return this.#config.env;
  }

  get siteCode() {
    return this.#config.siteCode;
  }

  get maxAmount() {
    return this.#config.maxAmount;
  }

  /** Fetch a bearer token, reusing the cached one until it is nearly expired. */
  async #accessToken() {
    if (this.#token && Date.now() < this.#tokenExpiresAt) return this.#token;

    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      scope: this.#config.scope,
    });

    const res = await fetch(this.#config.env.auth, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) {
      throw new OzowError(
        `Token request failed (${res.status}). Check the client ID and secret, ` +
          `and that the client has the "${this.#config.scope}" scope enabled.`,
        { status: res.status, body },
      );
    }

    this.#token = body.access_token;
    // Honour the server's lifetime, minus a minute of slack.
    const ttl = Number(body.expires_in ?? 3600);
    this.#tokenExpiresAt = Date.now() + Math.max(ttl - 60, 30) * 1000;
    return this.#token;
  }

  async #request(method, path, { body, query } = {}) {
    const token = await this.#accessToken();
    const url = new URL(`${this.#config.env.api}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v != null) url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 500) };
    }

    if (!res.ok) {
      throw new OzowError(`${method} ${path} failed (${res.status}).`, {
        status: res.status,
        body: parsed,
      });
    }
    return parsed;
  }

  createPayment({ amount, merchantReference, beneficiaryReference, returnUrl, notifyUrl, expireAt }) {
    return this.#request("POST", "/v1/payments", {
      body: {
        siteCode: this.#config.siteCode,
        amount: { currency: "ZAR", value: amount },
        merchantReference,
        ...(beneficiaryReference ? { beneficiaryReference } : {}),
        expireAt,
        returnUrl,
        ...(notifyUrl ? { notifyUrl } : {}),
      },
    });
  }

  listTransactions(paymentId, { fromDate, toDate } = {}) {
    return this.#request("GET", `/v1/payments/${encodeURIComponent(paymentId)}/transactions`, {
      query: { fromDate, toDate },
    });
  }

  cancelPayment(paymentId) {
    return this.#request("POST", `/v1/payments/${encodeURIComponent(paymentId)}/cancel`);
  }

  /** Cheapest call that proves the credentials work. */
  async verifyCredentials() {
    await this.#accessToken();
    return true;
  }
}
