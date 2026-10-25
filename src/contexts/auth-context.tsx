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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          const data = userDoc.data();

          // A Firebase login alone is not access: the account must have been created in
          // Usuários and still be active. Otherwise the person would land in a shell where
          // every screen fails with "não autorizado".
          if (!userDoc.exists() || data?.isActive === false) {
            setAccessError(
              userDoc.exists()
                ? "Este usuário foi desativado. Fale com o administrador da loja."
                : "Este login não tem acesso ao sistema. Fale com o administrador da loja."
            );
            setUser(null);
            setUserData(null);
            setLoading(false);
            await firebaseSignOut(auth);
            return;
          }

          setUser(firebaseUser);
          setUserData({
            id: firebaseUser.uid,
            ...data,
          } as UserData);
        } catch (error) {
          console.error("Failed to fetch user data:", error);
          setUser(firebaseUser);
        }
      } else {
        setUser(null);
        setUserData(null);
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
