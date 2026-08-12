# AI Rules & Architecture Guidelines

## Tech Stack Overview
- **Framework & Runtime**: Next.js 16 (App Router) with React 19 and TypeScript.
- **Styling**: Tailwind CSS v4 with custom CSS variables configured in `app/globals.css`.
- **Icons**: `lucide-react` icon library for UI icons.
- **Database & Authentication**: Firebase v12 (Firebase Auth for user/admin accounts and Firestore for real-time document storage).
- **Hardware Communication**: Web Serial API (`navigator.serial`) interfacing directly with the K750 Card Dispenser via RS-232/USB serial connection.
- **State & Context Management**: React Context API for global state (`AuthProvider`, `K750Provider`, `ToastProvider`, `SidebarProvider`, `ThemeProvider`).
- **Deployment Platform**: Vercel (client-side serial communication via supported Chromium browsers like Chrome and Edge).

---

## Library & Module Usage Rules

### 1. UI Components & Layouts
- **Tailwind CSS v4**: Use utility classes for styling. Adhere to design tokens defined in `app/globals.css` (e.g., `--bg-base`, `--accent`, `--border-subtle`).
- **Icons**: Use `lucide-react` exclusively for icons across operator, admin, and kiosk interfaces.
- **Layouts**:
  - Admin routes (`/admin/*`) live inside `app/admin/layout.tsx` with sidebar navigation.
  - Operator routes (`/dashboard/*`) live inside `app/dashboard/layout.tsx`.
  - Self-service Kiosk page lives at `app/kiosk/page.tsx` with standalone, touch-optimized layout.

### 2. Hardware & Serial Operations
- **K750 Protocol (`lib/k750-protocol.ts`)**: Low-level packet builder, BCC checksum, and response status frame decoders. Do not duplicate packet building logic elsewhere.
- **K750 Service (`lib/k750-service.ts`)**: Handles Serial I/O streams, buffer management, transaction locks, and high-level card dispensing flows (`issueCard`, `ejectFC0`, `queryAP`, `resetDevice`).
- **K750 Context (`lib/k750-context.tsx`)**: Use the `useK750()` hook to consume device connection status and raw status frames across components.

### 3. Database & Services (`lib/firestore-service.ts`)
- **Firestore Access**: Always use centralized functions from `lib/firestore-service.ts` for database reads/writes (`getAllCardIssues`, `logCardIssue`, `updateCardIssue`, `getEmployees`, `getAllUsers`, `getActivityLogs`, `getSettings`).
- **Timestamps**: Always pass Firestore server timestamps or parse fields using the `toDate` helper.

### 4. Authentication & Security
- **Auth Provider (`lib/auth-context.tsx`)**: Use `useAuth()` hook for accessing current Firebase user, profile details, and role checks (`admin` vs. `user`/operator).
- **Route Guarding**: Admin routes check `profile.role === "admin"` client-side while Firestore security rules enforce backend permissions.

### 5. Notifications
- **Toast Context (`lib/toast-context.tsx`)**: Use `useToast()` to display real-time user feedback (`toast(message, "success" | "error" | "info")`).