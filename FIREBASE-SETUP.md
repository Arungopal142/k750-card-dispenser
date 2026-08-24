# Fixing "Missing or insufficient permissions"

That error comes from the Firestore **server**, not from the app code. It means the
rules deployed to project `card-dispenser-fc7b3` rejected the read or write. The
client config being correct makes no difference — rules are evaluated server-side
against the signed-in user.

Work through these in order.

## 1. Deploy the rules and indexes (most likely cause)

`firestore.rules` in this repo guarded `card_issues`, `activity_logs` and
`device_logs`, while the app has always written `cardIssues`, `activityLogs` and
`deviceLogs`. Unmatched paths are denied by default, so **every** operation on
those collections failed. That is fixed in the file — but a file in the repo does
nothing until it is deployed:

```bash
npm install -g firebase-tools     # once
firebase login
firebase use card-dispenser-fc7b3
firebase deploy --only firestore:rules,firestore:indexes
```

Or paste `firestore.rules` into
**Firebase console → Firestore Database → Rules → Publish**.

Two other things that produce the identical error:

- **Expired test-mode rules.** A project created "in test mode" gets
  `allow read, write: if request.time < timestamp.date(...)`. After that date
  everything is denied. Check the Rules tab for a date in the past.
- **Locked mode.** `allow read, write: if false` denies everything.

## 2. Check your own user document

Almost every rule calls:

```
function isUserActive() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.active == true;
}
```

If `users/{your-uid}` is missing, or has no `active` field, or has `active: false`,
**every** read and write is denied — including your own dashboard.

In the console open **Firestore → users → <your uid>** and confirm:

| field | value |
| --- | --- |
| `active` | `true` (boolean, not the string `"true"`) |
| `role` | `"admin"` or `"user"` |

A document created by hand in the console, or an account created before the
`active` field existed, is the usual reason this is missing.

## 3. Indexes

`subscribeIssuedCards` (the checkout list) needs the composite index
`cardIssues: status ASC, issuedAt DESC`. Without it the query is rejected — this
reports as a *failed-precondition*, not a permission error, and the app now shows
the deploy command. `firestore.indexes.json` has it plus the three others the app
needs. The console error message also contains a one-click "create index" link.

## 4. The kiosk will always be denied

`/kiosk` has no login, but `logCardIssue()` runs against a rule requiring
`isActiveUser() && request.resource.data.issuedById == request.auth.uid`. With no
signed-in user there is no `request.auth`, so the write is denied every time.

Pick one:

- **Anonymous auth** — enable it in Authentication → Sign-in method, call
  `signInAnonymously()` on the kiosk page, and allow anonymous users to create
  card issues; or
- put the kiosk behind an operator login like the other pages.

Nothing in this repo does either yet.

## What changed in the app

The error should no longer take the page down. It previously surfaced as a Next.js
runtime overlay because `fetchStats()` on the operator dashboard had no
`try/catch`, and every `onSnapshot` except one had no error callback — a rejected
listener became an unhandled exception.

- `app/dashboard/page.tsx` — the stats fetch is guarded and shows an inline banner.
- `lib/firestore-service.ts` — `subscribeAllCardIssues`, `subscribeMyCardIssues`,
  `subscribeMyCardIssuesByName` and all seven listeners inside `subscribeStats`
  now take an `onError` callback; in `subscribeStats` a denied collection still
  counts toward "loaded" so one failure cannot stall the other six.
- Permission and index failures are reported with the command that fixes them.

## Config note

Your pasted config matches `.env.local` except the app ID:

```
was:  1:219797919472:web:acbd4571779dfe14ba5435
now:  1:219797919472:web:acb741267c0b8275ba5435
```

Same project, same API key, same sender — two separate **web app registrations**
inside `card-dispenser-fc7b3`. `.env.local` now uses the one you pasted. This has
no bearing on the permission error: the app ID does not affect Firestore access.

`getAnalytics()` from your snippet is not wired up — `lib/firebase.ts` initialises
auth and Firestore only. `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` is now in
`.env.local` if you want to add it later. Note that `getAnalytics()` throws during
server-side rendering, so it must be guarded with `isSupported()` or called inside
a `useEffect`.
