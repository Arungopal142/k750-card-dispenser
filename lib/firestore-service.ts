import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  doc,
  query,
  orderBy,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "./firebase";
const getDb = () => db();

export function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (val instanceof Timestamp) return val.toDate();
  if (typeof val === "object" && val !== null && "seconds" in val) {
    return new Date((val as { seconds: number }).seconds * 1000);
  }
  if (typeof val === "string" || typeof val === "number") {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateTime(val: unknown): string {
  const d = toDate(val);
  return d ? d.toLocaleString() : "—";
}

export interface UserProfile {
  id?: string;
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "user";
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Employee {
  id?: string;
  name: string;
  department: string;
  employeeId: string;
  rfidCardNumber?: string;
  email?: string;
  phone?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CardIssue {
  id?: string;
  employeeId: string;
  employeeName: string;
  department: string;
  issuedBy: string;
  issuedById: string;
  issuedAt: unknown;
  status: "Processing" | "Issued" | "Failed" | "Collected";
  checkoutAt?: unknown;
  checkedOutBy?: string;
  deviceId?: string;
  errorMessage?: string;
  visitorId?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  hostName?: string;
  purpose?: string;
  nationalId?: string;
  source?: "K750" | "VMS";
}

export interface ActivityLog {
  id?: string;
  userId: string;
  userName: string;
  action: string;
  details?: string;
  timestamp?: unknown;
}

export interface DeviceLog {
  id?: string;
  deviceId: string;
  deviceName?: string;
  event: string;
  details?: string;
  timestamp?: unknown;
  status?: string;
}

export interface AppSettings {
  id?: string;
  [key: string]: unknown;
}

// ─── Users ────────────────────────────────────────────────────────────

export async function getAllUsers(): Promise<UserProfile[]> {
  const q = query(collection(getDb(), "users"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as UserProfile));
}

export async function updateUser(
  id: string,
  data: Partial<UserProfile>
): Promise<void> {
  await updateDoc(doc(getDb(), "users", id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteUser(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "users", id));
}

// ─── Employees ────────────────────────────────────────────────────────

export async function addEmployee(
  employee: Omit<Employee, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const docRef = await addDoc(collection(getDb(), "employees"), {
    ...employee,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function getEmployees(): Promise<Employee[]> {
  const q = query(collection(getDb(), "employees"), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as Employee)
  );
}

export async function updateEmployee(
  id: string,
  data: Partial<Employee>
): Promise<void> {
  await updateDoc(doc(getDb(), "employees", id), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteEmployee(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), "employees", id));
}

// ─── Card Issues ──────────────────────────────────────────────────────

export async function logCardIssue(
  issue: Omit<CardIssue, "id" | "issuedAt">
): Promise<string> {
  const docRef = await addDoc(collection(getDb(), "cardIssues"), {
    ...issue,
    issuedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateCardIssue(
  id: string,
  data: Partial<CardIssue>
): Promise<void> {
  await updateDoc(doc(getDb(), "cardIssues", id), data);
}

export async function getAllCardIssues(): Promise<CardIssue[]> {
  const q = query(
    collection(getDb(), "cardIssues"),
    orderBy("issuedAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as CardIssue)
  );
}

export async function getMyCardIssues(
  issuedById: string
): Promise<CardIssue[]> {
  const q = query(
    collection(getDb(), "cardIssues"),
    where("issuedById", "==", issuedById),
    orderBy("issuedAt", "desc")
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as CardIssue)
  );
}

export function subscribeAllCardIssues(
  callback: (issues: CardIssue[]) => void
): () => void {
  const q = query(
    collection(getDb(), "cardIssues"),
    orderBy("issuedAt", "desc")
  );
  return onSnapshot(q, (snapshot) => {
    const issues = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() } as CardIssue)
    );
    callback(issues);
  });
}

export function subscribeMyCardIssues(
  issuedById: string,
  callback: (issues: CardIssue[]) => void
): () => void {
  const q = query(
    collection(getDb(), "cardIssues"),
    where("issuedById", "==", issuedById),
    orderBy("issuedAt", "desc")
  );
  return onSnapshot(q, (snapshot) => {
    const issues = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() } as CardIssue)
    );
    callback(issues);
  });
}

export function subscribeMyCardIssuesByName(
  issuedBy: string,
  callback: (issues: CardIssue[]) => void
): () => void {
  const q = query(
    collection(getDb(), "cardIssues"),
    where("issuedBy", "==", issuedBy),
    orderBy("issuedAt", "desc")
  );
  return onSnapshot(q, (snapshot) => {
    const issues = snapshot.docs.map(
      (d) => ({ id: d.id, ...d.data() } as CardIssue)
    );
    callback(issues);
  });
}

// ─── Stats / Dashboard ────────────────────────────────────────────────

export function subscribeStats(
  callback: (stats: {
    totalUsers: number;
    totalEmployees: number;
    totalCardsIssued: number;
    todayCardsIssued: number;
    failedTransactions: number;
    collectedCards: number;
    recentActivities: ActivityLog[];
  }) => void
): () => void {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTimestamp = Timestamp.fromDate(todayStart);

  const usersQ = query(collection(getDb(), "users"));
  const employeesQ = query(collection(getDb(), "employees"));
  const allIssuesQ = query(
    collection(getDb(), "cardIssues"),
    orderBy("issuedAt", "desc")
  );
  const todayIssuesQ = query(
    collection(getDb(), "cardIssues"),
    where("issuedAt", ">=", todayTimestamp)
  );
  const failedQ = query(
    collection(getDb(), "cardIssues"),
    where("status", "==", "Failed")
  );
  const collectedQ = query(
    collection(getDb(), "cardIssues"),
    where("status", "==", "Collected")
  );
  const activityQ = query(
    collection(getDb(), "activityLogs"),
    orderBy("timestamp", "desc")
  );

  const unsubs: (() => void)[] = [];
  let counts = {
    totalUsers: 0,
    totalEmployees: 0,
    totalCardsIssued: 0,
    todayCardsIssued: 0,
    failedTransactions: 0,
    collectedCards: 0,
    recentActivities: [] as ActivityLog[],
  };
  let loaded = 0;
  const total = 7;

  function emit() {
    loaded++;
    if (loaded >= total) callback({ ...counts });
  }

  unsubs.push(
    onSnapshot(usersQ, (s) => {
      counts.totalUsers = s.size;
      emit();
    })
  );
  unsubs.push(
    onSnapshot(employeesQ, (s) => {
      counts.totalEmployees = s.size;
      emit();
    })
  );
  unsubs.push(
    onSnapshot(allIssuesQ, (s) => {
      counts.totalCardsIssued = s.size;
      emit();
    })
  );
  unsubs.push(
    onSnapshot(todayIssuesQ, (s) => {
      counts.todayCardsIssued = s.size;
      emit();
    })
  );
  unsubs.push(
    onSnapshot(failedQ, (s) => {
      counts.failedTransactions = s.size;
      emit();
    })
  );
  unsubs.push(
    onSnapshot(collectedQ, (s) => {
      counts.collectedCards = s.size;
      emit();
    })
  );
  unsubs.push(
    onSnapshot(activityQ, (s) => {
      counts.recentActivities = s.docs.slice(0, 10).map(
        (d) => ({ id: d.id, ...d.data() } as ActivityLog)
      );
      emit();
    })
  );

  return () => unsubs.forEach((u) => u());
}

export async function getStats(): Promise<{
  totalUsers: number;
  totalEmployees: number;
  totalCardsIssued: number;
  todayCardsIssued: number;
  failedTransactions: number;
  collectedCards: number;
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTimestamp = Timestamp.fromDate(todayStart);

  const [usersSnap, employeesSnap, allIssuesSnap, todaySnap, failedSnap, collectedSnap] =
    await Promise.all([
      getDocs(collection(getDb(), "users")),
      getDocs(collection(getDb(), "employees")),
      getDocs(collection(getDb(), "cardIssues")),
      getDocs(
        query(
          collection(getDb(), "cardIssues"),
          where("issuedAt", ">=", todayTimestamp)
        )
      ),
      getDocs(
        query(collection(getDb(), "cardIssues"), where("status", "==", "Failed"))
      ),
      getDocs(
        query(collection(getDb(), "cardIssues"), where("status", "==", "Collected"))
      ),
    ]);

  return {
    totalUsers: usersSnap.size,
    totalEmployees: employeesSnap.size,
    totalCardsIssued: allIssuesSnap.size,
    todayCardsIssued: todaySnap.size,
    failedTransactions: failedSnap.size,
    collectedCards: collectedSnap.size,
  };
}

// ─── Activity Logs ────────────────────────────────────────────────────

export async function logActivity(
  activity: Omit<ActivityLog, "id" | "timestamp">
): Promise<string> {
  const docRef = await addDoc(collection(getDb(), "activityLogs"), {
    ...activity,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}

export async function getActivityLogs(
  limit?: number
): Promise<ActivityLog[]> {
  let q = query(
    collection(getDb(), "activityLogs"),
    orderBy("timestamp", "desc")
  );
  if (limit) {
    const { limit: firestoreLimit } = await import("firebase/firestore");
    q = query(q, firestoreLimit(limit));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as ActivityLog)
  );
}

// ─── Device Logs ──────────────────────────────────────────────────────

export async function logDevice(
  log: Omit<DeviceLog, "id" | "timestamp">
): Promise<string> {
  const docRef = await addDoc(collection(getDb(), "deviceLogs"), {
    ...log,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
}

export async function getDeviceLogs(
  deviceId?: string,
  limit?: number
): Promise<DeviceLog[]> {
  let q;
  if (deviceId) {
    q = query(
      collection(getDb(), "deviceLogs"),
      where("deviceId", "==", deviceId),
      orderBy("timestamp", "desc")
    );
  } else {
    q = query(
      collection(getDb(), "deviceLogs"),
      orderBy("timestamp", "desc")
    );
  }
  if (limit) {
    const { limit: firestoreLimit } = await import("firebase/firestore");
    q = query(q, firestoreLimit(limit));
  }
  const snapshot = await getDocs(q);
  return snapshot.docs.map(
    (d) => ({ id: d.id, ...d.data() } as DeviceLog)
  );
}

// ─── App Settings ─────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings | null> {
  const docSnap = await getDoc(doc(getDb(), "settings", "app"));
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() } as AppSettings;
}

export async function updateSettings(
  data: Partial<AppSettings>
): Promise<void> {
  await setDoc(doc(getDb(), "settings", "app"), data, { merge: true });
}
