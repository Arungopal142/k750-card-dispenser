import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const requiredEnvVars = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
] as const;

const missing = requiredEnvVars.filter((k) => !process.env[k]);
if (typeof window !== "undefined" && missing.length > 0) {
  console.error(
    `Firebase: missing env vars: ${missing.join(", ")}. ` +
    "Add them in Vercel → Settings → Environment Variables and redeploy."
  );
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function getApp(): FirebaseApp {
  if (!_app) _app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  return _app;
}

function getFirebaseAuth(): Auth {
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    throw new Error("Firebase not configured — missing NEXT_PUBLIC_FIREBASE_API_KEY. Add it in Vercel → Settings → Environment Variables and redeploy.");
  }
  if (!_auth) _auth = getAuth(getApp());
  return _auth;
}

function getFirebaseDb(): Firestore {
  if (!process.env.NEXT_PUBLIC_FIREBASE_API_KEY) {
    throw new Error("Firebase not configured — missing NEXT_PUBLIC_FIREBASE_API_KEY. Add it in Vercel → Settings → Environment Variables and redeploy.");
  }
  if (!_db) _db = getFirestore(getApp());
  return _db;
}

export { getApp as app, getFirebaseAuth as auth, getFirebaseDb as db };
