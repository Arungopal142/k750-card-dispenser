"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInAnonymously,
  createUserWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db, isFirebaseConfigured } from "./firebase";

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
  loginAnonymously: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  authError: null,
  login: async () => {},
  register: async () => {},
  loginAnonymously: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthError("Firebase not configured. Add NEXT_PUBLIC_FIREBASE_* env vars in Vercel → Settings → Environment Variables and redeploy.");
      setLoading(false);
      return;
    }
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
              setLoading(false);
            } else {
              setProfile({ uid: firebaseUser.uid, email: firebaseUser.email ?? "", displayName: firebaseUser.displayName ?? firebaseUser.email?.split("@")[0] ?? "", role: data.role ?? "user", active: data.active ?? true });
              setAuthError(null);
              setLoading(false);
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
            setLoading(false);
          }
        } catch { setProfile(null); setLoading(false); }
      } else {
        setProfile(null);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    if (!isFirebaseConfigured) { const e = new Error("Firebase not configured."); setAuthError(e.message); throw e; }
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

  const register = useCallback(async (email: string, password: string, _displayName: string) => {
    setAuthError(null);
    if (!isFirebaseConfigured) { const e = new Error("Firebase not configured."); setAuthError(e.message); throw e; }
    try {
      await createUserWithEmailAndPassword(auth(), email, password);
      // Profile is created automatically by onAuthStateChanged fallback
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      throw err;
    }
  }, []);

  const loginAnonymously = useCallback(async () => {
    setAuthError(null);
    if (!isFirebaseConfigured) { const e = new Error("Firebase not configured."); setAuthError(e.message); throw e; }
    try {
      const cred = await signInAnonymously(auth());
      const fallback: UserProfile = {
        uid: cred.user.uid,
        email: "",
        displayName: "Kiosk User",
        role: "user",
        active: true,
      };
      try {
        await setDoc(doc(db(), "users", cred.user.uid), {
          ...fallback,
          createdAt: serverTimestamp(),
        });
      } catch { /* */ }
      setProfile(fallback);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAuthError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    if (!isFirebaseConfigured) return;
    await signOut(auth());
    setProfile(null);
    setAuthError(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, authError, login, register, loginAnonymously, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
