/**
 * [webchat] Relay bearer-token management.
 *
 * Kept separate from relayServer.ts so UI code (preferences) can import the
 * token helpers without loading the relay module, which touches the global
 * Zotero object at module scope and must stay lazily imported.
 */
import { config } from "../../package.json";

export const WEBCHAT_RELAY_TOKEN_PREF_KEY = `${config.prefsPrefix}.webchatRelayToken`;

let cachedRelayToken: string | null = null;

function generateRelayToken(): string {
  const bytes = new Uint8Array(32);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoApi?.getRandomValues) {
    // Never fall back to Math.random() — a guessable token would let any
    // local process hijack the WebChat pipeline.
    throw new Error(
      "crypto.getRandomValues is unavailable; cannot generate a secure relay token",
    );
  }
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type RelayPrefs = {
  get?: (key: string, global?: boolean) => unknown;
  set?: (key: string, value: unknown, global?: boolean) => void;
};

function getRelayPrefs(): RelayPrefs | null {
  return (
    (globalThis as { Zotero?: { Prefs?: RelayPrefs } }).Zotero?.Prefs || null
  );
}

/**
 * Return the persistent relay auth token, creating it on first use.
 * Falls back to a process-lifetime token when Zotero prefs are unavailable
 * (e.g. in tests).
 */
export function getOrCreateWebChatRelayToken(): string {
  const prefs = getRelayPrefs();
  const existing = prefs?.get?.(WEBCHAT_RELAY_TOKEN_PREF_KEY, true);
  if (typeof existing === "string" && existing.trim().length >= 32) {
    cachedRelayToken = existing.trim();
    return cachedRelayToken;
  }
  if (cachedRelayToken) return cachedRelayToken;
  const token = generateRelayToken();
  cachedRelayToken = token;
  prefs?.set?.(WEBCHAT_RELAY_TOKEN_PREF_KEY, token, true);
  return token;
}

/** Rotate the relay auth token (invalidates all existing clients). */
export function resetWebChatRelayToken(): string {
  const token = generateRelayToken();
  cachedRelayToken = token;
  getRelayPrefs()?.set?.(WEBCHAT_RELAY_TOKEN_PREF_KEY, token, true);
  return token;
}

export function timingSafeTokenEquals(left: string, right: string): boolean {
  if (left.length !== right.length || !left.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
