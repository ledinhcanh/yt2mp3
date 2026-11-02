import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { buildURL, getHeaders, USER_AGENT } from "bgutils-js/utils";
import { JSDOM, type ConstructorOptions } from "jsdom";

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const FETCH_TIMEOUT_MS = 15_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const MINTER_TTL_MS = 9 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

interface Minter {
  createdAt: number;
  dom: JSDOM;
  mint: (contentBinding: string) => Promise<string>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let minterPromise: Promise<Minter | null> | null = null;
let mintQueue: Promise<void> = Promise.resolve();
const tokenCache = new Map<string, CachedToken>();

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, {
    ...init,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

function base64ToBytes(value: string): Uint8Array {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function toWebSafeBase64(value: ArrayBufferView): string {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64url");
}

async function createMinter(): Promise<Minter | null> {
  try {
    const challenge = await getChallenge({
      fetchFunction: fetchWithTimeout,
      requestKey: REQUEST_KEY,
    });

    const interpreterJavascript =
      challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreterJavascript || !challenge.program || !challenge.globalName) {
      throw new Error("BotGuard challenge is missing required fields");
    }

    // Keep the BotGuard VM inside the jsdom realm so the server process never
    // gets a global `window`/`document` (which would confuse Next.js SSR).
    // jsdom 26 accepts `userAgent` at the top level, while @types/jsdom@30
    // moved its type under `resources`. Keep the runtime option and widen the type.
    const domOptions = {
      url: "https://www.youtube.com/",
      referrer: "https://www.youtube.com/",
      userAgent: USER_AGENT,
      runScripts: "outside-only",
    } satisfies ConstructorOptions & { userAgent: string };

    const dom = new JSDOM(
      '<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>',
      domOptions,
    );

    dom.window.eval(interpreterJavascript);

    const botGuardClient = await BotGuardClient.create({
      program: challenge.program,
      globalName: challenge.globalName,
      globalObject: dom.window,
    });

    const webPoSignalOutput: WebPoSignalOutput = [];
    const botguardResponse = await botGuardClient.snapshot(
      { webPoSignalOutput },
      SNAPSHOT_TIMEOUT_MS,
    );

    const integrityResponse = await fetchWithTimeout(buildURL("GenerateIT", true), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    });

    if (!integrityResponse.ok) {
      throw new Error(`GenerateIT failed: ${integrityResponse.status}`);
    }

    const integrityJson = (await integrityResponse.json()) as unknown[];
    const integrityToken = integrityJson[0];

    if (typeof integrityToken !== "string") {
      throw new Error("GenerateIT returned an invalid integrity token");
    }

    const getMinter = webPoSignalOutput[0];
    if (typeof getMinter !== "function") {
      throw new Error("BotGuard did not expose a PoToken minter");
    }

    // The callback comes from the jsdom realm, so `instanceof` checks from
    // bgutils-js/WebPoMinter fail across realms. Call it directly instead.
    const mintCallback = await getMinter(base64ToBytes(integrityToken));
    if (typeof mintCallback !== "function") {
      throw new Error("BotGuard minter callback is unavailable");
    }

    return {
      createdAt: Date.now(),
      dom,
      mint: async (contentBinding: string) => {
        const result = await mintCallback(new TextEncoder().encode(contentBinding));
        if (!result || !ArrayBuffer.isView(result)) {
          throw new Error("BotGuard returned an invalid PoToken");
        }
        return toWebSafeBase64(result);
      },
    };
  } catch (error) {
    console.error("[potoken] initialization failed", error);
    return null;
  }
}

function getMinter(): Promise<Minter | null> {
  if (!minterPromise) {
    minterPromise = createMinter();
  }
  return minterPromise;
}

function remember(videoId: string, token: string) {
  tokenCache.delete(videoId);
  tokenCache.set(videoId, {
    token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });

  while (tokenCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = tokenCache.keys().next().value;
    if (oldestKey === undefined) break;
    tokenCache.delete(oldestKey);
  }
}

async function mintPoToken(videoId: string): Promise<string | null> {
  const cached = tokenCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  let minter = await getMinter();

  if (minter && Date.now() - minter.createdAt > MINTER_TTL_MS) {
    minterPromise = createMinter();
    minter = await minterPromise;
  }

  if (!minter) return null;

  try {
    const token = await minter.mint(videoId);
    remember(videoId, token);
    return token;
  } catch (error) {
    console.error("[potoken] mint failed", videoId, error);
    minterPromise = null;
    return null;
  }
}

export function getPoToken(videoId: string): Promise<string | null> {
  const result = mintQueue.then(() => mintPoToken(videoId));
  mintQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function resetPoTokenProvider() {
  minterPromise = null;
  tokenCache.clear();
}
