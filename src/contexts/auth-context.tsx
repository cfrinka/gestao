"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, ReactNode } from "react";
import {
  User,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { clearApiCache } from "@/lib/api-client";
import { storedSessionUid } from "@/lib/stored-session";

// Layout effects only run in the browser; on the server render this is a plain no-op effect.
const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface UserData {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CASHIER";
}

interface AuthContextType {
  user: User | null;
  userData: UserData | null;
  loading: boolean;
  /** Why the last sign-in was turned away (no access record, or deactivated), for the login screen. */
  accessError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// The last confirmed profile, so a returning user sees the app immediately; it is rechecked
// against the server right after and dropped if access was removed.
const PROFILE_KEY = "bene:profile";

function readCachedProfile(uid: string): UserData | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const profile = raw ? (JSON.parse(raw) as UserData) : null;
    return profile && profile.id === uid ? profile : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: UserData | null) {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // storage unavailable (private window): the app just checks with the server every time
  }
}

type AccessResponse =
  | { access: "ok"; user: UserData }
  | { access: "missing" | "inactive" | "signed_out" | "unknown" };

async function fetchAccess(firebaseUser: User): Promise<AccessResponse> {
  const token = await firebaseUser.getIdToken();
  const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  return (await res.json().catch(() => ({ access: "unknown" }))) as AccessResponse;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  // A returning user with a stored session and a known profile gets the app before the first
  // paint; the Firebase check and the access check below confirm (or undo) it moments later.
  useBrowserLayoutEffect(() => {
    const uid = storedSessionUid();
    const profile = uid ? readCachedProfile(uid) : null;
    if (profile) {
      setUserData(profile);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let lastUid: string | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Answers remembered for one login must never be shown to the next.
      const uid = firebaseUser?.uid ?? null;
      if (uid !== lastUid) {
        clearApiCache();
        lastUid = uid;
      }

      if (!firebaseUser) {
        setUser(null);
        setUserData(null);
        setLoading(false);
        return;
      }

      const cachedProfile = readCachedProfile(firebaseUser.uid);
      if (cachedProfile) {
        setUser(firebaseUser);
        setUserData(cachedProfile);
        setLoading(false);
      }

      try {
        const result = await fetchAccess(firebaseUser);

        // A Firebase login alone is not access: the account must have been created in
        // Usuários and still be active. Otherwise the person would land in a shell where
        // every screen fails with "não autorizado".
        if (result.access === "missing" || result.access === "inactive") {
          setAccessError(
            result.access === "inactive"
              ? "Este usuário foi desativado. Fale com o administrador da loja."
              : "Este login não tem acesso ao sistema. Fale com o administrador da loja."
          );
          writeCachedProfile(null);
          setUser(null);
          setUserData(null);
          setLoading(false);
          await firebaseSignOut(auth);
          return;
        }

        if (result.access === "ok") {
          writeCachedProfile(result.user);
          setUser(firebaseUser);
          setUserData(result.user);
        } else if (!cachedProfile) {
          // Server unreachable and nothing cached: let the shell open; requests will report errors.
          setUser(firebaseUser);
        }
      } catch (error) {
        console.error("Failed to fetch user data:", error);
        if (!cachedProfile) setUser(firebaseUser);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    setAccessError(null);
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    writeCachedProfile(null);
    clearApiCache();
    await firebaseSignOut(auth);
    setUserData(null);
  };

  return (
    <AuthContext.Provider value={{ user, userData, loading, accessError, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
