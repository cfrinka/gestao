"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  User,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

interface UserData {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CASHIER";
}

type AuthUserLike = User | { uid: string };

interface AuthContextType {
  user: AuthUserLike | null;
  userData: UserData | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Only present in demo-mode builds — logs in as one of the two fixed demo identities. */
  enterDemo?: (role: "ADMIN" | "CASHIER") => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        if (userDoc.exists()) {
          setUserData({
            id: firebaseUser.uid,
            ...userDoc.data(),
          } as UserData);
        }
      } else {
        setUserData(null);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUserData(null);
  };

  return (
    <AuthContext.Provider value={{ user, userData, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Demo-mode auth: never touches the Firebase client SDK. Session state lives in an httpOnly
 * `demo_session` cookie (set by POST /api/demo/login) that rides along automatically on
 * same-origin fetches — src/lib/api-client.ts already skips the Firebase ID-token header
 * whenever `auth.currentUser` is null, which is always true here since we never sign in to
 * Firebase, so no changes were needed there.
 */
function DemoAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ uid: string } | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/demo/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { uid: string; email: string; name: string; role: "ADMIN" | "CASHIER" } | null) => {
        if (cancelled || !data) return;
        setUser({ uid: data.uid });
        setUserData({ id: data.uid, email: data.email, name: data.name, role: data.role });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const enterDemo = async (role: "ADMIN" | "CASHIER") => {
    const res = await fetch("/api/demo/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      throw new Error("Failed to enter demo mode");
    }
    const data = (await res.json()) as { uid: string; email: string; name: string; role: "ADMIN" | "CASHIER" };
    setUser({ uid: data.uid });
    setUserData({ id: data.uid, email: data.email, name: data.name, role: data.role });
  };

  const signIn = async () => {
    throw new Error("This is a demo deployment — use enterDemo(role) instead of signIn.");
  };

  const signOut = async () => {
    await fetch("/api/demo/logout", { method: "POST" });
    setUser(null);
    setUserData(null);
  };

  return (
    <AuthContext.Provider value={{ user, userData, loading, signIn, signOut, enterDemo }}>
      {children}
    </AuthContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (DEMO_MODE) {
    return <DemoAuthProvider>{children}</DemoAuthProvider>;
  }
  return <FirebaseAuthProvider>{children}</FirebaseAuthProvider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
