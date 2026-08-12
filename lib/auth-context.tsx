"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "user";
  active: boolean;
  createdAt?: unknown;
}

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  authError: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth(), async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const snap = await getDoc(doc(db(), "users", firebaseUser.uid));
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            if (data.active === false) {
              await signOut(auth());
              setAuthError("Account is deactivated. Contact admin.");
              setUser(null);
              setProfile(null);
            } else {
              setProfile({ uid: firebaseUser.uid, email: firebaseUser.email ?? "", displayName: firebaseUser.displayName ?? firebaseUser.email?.split("@")[0] ?? "", role: data.role ?? "user", active: data.active ?? true });
              setAuthError(null);
            }
          } else {
            const fallback: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email ?? "",
              displayName: firebaseUser.displayName ?? firebaseUser.email?.split("@")[0] ?? "",
              role: "user",
              active: true,
            };
            try { await setDoc(doc(db(), "users", firebaseUser.uid), { ...fallback, createdAt: serverTimestamp() }); } catch { /* */ }
            setProfile(fallback);
          }
        } catch { setProfile(null); }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    try {
      const cred = await signInWithEmailAndPassword(auth(), email, password);
      const snap = await getDoc(doc(db(), "users", cred.user.uid));
      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (data.active === false) {
          await signOut(auth());
          throw new Error("Account is deactivated. Contact admin.");
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      throw err;
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth(), email, password);
      await setDoc(doc(db(), "users", cred.user.uid), {
        uid: cred.user.uid,
        email,
        displayName,
        role: "user",
        active: true,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth());
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, authError, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
