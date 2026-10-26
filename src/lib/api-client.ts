import type { User } from "firebase/auth";
import { auth } from "./firebase";
import { storedIdToken } from "./stored-session";
import { toast } from "@/components/ui/use-toast";

/** A refusal from the server: its message is written for the person at the counter. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

let lastDemoToastAt = 0;

function maybeNotifyDemo(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const data = payload as { demo?: boolean; message?: string };
  if (data.demo !== true) return;

  const now = Date.now();
  if (now - lastDemoToastAt < 1500) return;
  lastDemoToastAt = now;

  toast({
    title: "Modo demonstrativo",
    description: data.message || "Suas alterações não foram salvas no banco de dados.",
    variant: "neutral",
  });
}

// A function call, so TypeScript re-reads the user after an await instead of keeping a narrowed type.
function currentUser(): User | null {
  return auth.currentUser;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  let token: string | null = null;
  if (auth.currentUser) {
    token = await auth.currentUser.getIdToken();
  } else {
    // Right after a page load the SDK is still re-validating the stored login; its token is
    // already valid, so requests don't have to wait for that round trip.
    token = storedIdToken();
    if (!token) {
      await auth.authStateReady();
      const readyUser = currentUser();
      token = readyUser ? await readyUser.getIdToken() : null;
    }
  }

  if (!token) {
    return { "Content-Type": "application/json" };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function request(url: string, init: RequestInit = {}, notifyDemo = true) {
  const headers = await getAuthHeaders();

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }

  if (!res.ok) {
    const error = await res.json().catch(() => null);
    throw new ApiError(
      (error && typeof error.error === "string" && error.error) || "Falha ao falar com o servidor. Tente de novo.",
      res.status,
      error && typeof error.code === "string" ? error.code : undefined
    );
  }

  const json = await res.json();
  if (notifyDemo) maybeNotifyDemo(json);
  return json;
}

/**
 * Short-lived memory of GET answers: going back to a screen seen a moment ago is instant, and
 * screens that ask for the same thing at once share one request. Any write made from this
 * browser clears it, so nothing shown after your own action predates it. Data changed by
 * someone else shows up within the TTL (and the server always validates stock and prices).
 */
const GET_TTL_MS = 30 * 1000;
const getCache = new Map<string, { at: number; promise: Promise<unknown> }>();

function clone<T>(value: T): T {
  // Screens sort and edit what they receive; each gets its own copy of the cached answer.
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export async function apiGet(url: string) {
  const hit = getCache.get(url);
  if (hit && Date.now() - hit.at < GET_TTL_MS) {
    return clone(await hit.promise);
  }

  const promise = request(url, {}, false);
  getCache.set(url, { at: Date.now(), promise });
  promise.catch(() => {
    if (getCache.get(url)?.promise === promise) getCache.delete(url);
  });
  return clone(await promise);
}

/** Forgets every remembered answer — on sign-in, sign-out or a change of user. */
export function clearApiCache() {
  getCache.clear();
}

/** Warms the GET memory for screens the user is likely to open next. Errors are ignored. */
export function prefetchApi(urls: string[]) {
  for (const url of urls) {
    apiGet(url).catch(() => {});
  }
}

async function write(url: string, init: RequestInit) {
  try {
    return await request(url, init);
  } finally {
    getCache.clear();
  }
}

export async function apiPost(url: string, data: unknown) {
  return write(url, { method: "POST", body: JSON.stringify(data) });
}

export async function apiPut(url: string, data: unknown) {
  return write(url, { method: "PUT", body: JSON.stringify(data) });
}

export async function apiDelete(url: string) {
  return write(url, { method: "DELETE" });
}

export async function apiPatch(url: string, data: unknown) {
  return write(url, { method: "PATCH", body: JSON.stringify(data) });
}
