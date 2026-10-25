/**
 * The Firebase SDK keeps the signed-in user (and a valid ID token) in localStorage, but on every
 * page load it first re-validates that user with Google (~350 ms) before reporting anyone signed
 * in. Reading the stored session lets the app open and send its first requests right away; the
 * SDK's check still runs and signs the person out if the session was revoked. The server verifies
 * every token and checks the user's record on each request either way.
 */
interface StoredSession {
  uid: string;
  accessToken?: string;
  expirationTime?: number;
}

function readStoredSession(): StoredSession | null {
  try {
    const key = Object.keys(localStorage).find((k) => k.startsWith("firebase:authUser:"));
    if (!key) return null;
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (!value?.uid) return null;
    return {
      uid: String(value.uid),
      accessToken: value.stsTokenManager?.accessToken,
      expirationTime: Number(value.stsTokenManager?.expirationTime || 0),
    };
  } catch {
    return null;
  }
}

/** The uid of the session stored in this browser, if any. */
export function storedSessionUid(): string | null {
  return readStoredSession()?.uid ?? null;
}

/** The stored ID token, only while it has more than a minute of validity left. */
export function storedIdToken(): string | null {
  const session = readStoredSession();
  if (!session?.accessToken || !session.expirationTime) return null;
  return session.expirationTime - Date.now() > 60 * 1000 ? session.accessToken : null;
}
