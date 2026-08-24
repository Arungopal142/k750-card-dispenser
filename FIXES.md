# K750 web app — issues found and fixed

Sources used: the four vendor documents in `reference documents/`, and the vendor
Android SDK (`k7x0_dll.jar` / `ttce_dll.jar`), decompiled to settle everything the
PDFs leave ambiguous. Where the two disagree, the SDK wins — it is what the
firmware actually answers to.

## 1. Device layer (`lib/k750-service.ts`, `lib/k750-protocol.ts`)

### 1.1 Movement commands were never executed  ← the big one
`sendCmdList2()` sent the command frame, read the ACK, and returned. It never sent
the ENQ.

The vendor SDK's transaction (`ttce.g.a(...)`, decompiled) is unambiguous:

```
write(command frame)
read 3 bytes                      // ACK + ADDH + ADDL
if (recv[0] != ACK)      return -106
if (address mismatch)    return -106
recv[0] = ENQ; write(recv, 3)     // ← always sent, for every command
if (!expectResponse)     return 0 // ← only the *response read* is conditional
read 5 header bytes … read LEN+2 … verify ETX
```

The ACK only means "frame parsed". The device performs the action when it
receives ENQ. So every motion command — FC7, FC0, DC, CP, DB, RS, FC4, FC6, FC8,
FD0–FD4, BE, BD — was acknowledged and then silently dropped. `transact()` (used
by AP and GV) did send ENQ, which is why status queries worked while nothing moved.

Fixed: `sendCmdList2()` now sends ACK → ENQ and skips only the response read.

### 1.2 Polling was too slow to see the card move
Every command slept 300 ms after the write *before* reading the reply, twice per
transaction, so one AP round-trip cost ~900 ms. An eject completes in well under a
second, so the sensor transition could pass entirely between two polls.

Fixed: the vendor gap is preserved *between* commands (`pace()`, 300 ms) but no
longer padded between a command and the reply it is already waiting for. An AP
round-trip is now ~350 ms.

### 1.3 Successful ejects reported as failures
`ejectDC()` / `ejectFC0()` only concluded "card ejected" after observing sensors
going active → clear. If the card left before the first poll, `sawSensorsActive`
was never set and a perfectly good eject returned `TARGET_NOT_CONFIRMED`.

Fixed: the channel is sampled *before* the command and seeds the sensor history.

### 1.4 An empty hopper aborted an eject already in progress
`ejectDC()` treated `boxEmpty` (B4 bit 3) as fatal. That bit describes the
*hopper*, not the channel — issuing the last card legitimately empties it, so the
last card of a stack failed with "Card box is empty" after physically coming out.
Now logged, not fatal. (`preIssueCheck()` still blocks *before* dispensing.)

### 1.5 "Card at reader" was a guess
The code assumed sensor 3 = RF read position. No vendor document says which of
S1/S2/S3 that is, and FC6/FC7 being separate commands proves it is not S2.

The SDK answers this properly: `K7X0_CheckCardPosition` sends **FC1** and the
firmware replies with a decoded position — `AT_READER`, `AT_FRONT`, `NO_CARD`,
`JAM`, `OVERLAP`. Implemented as `queryPosition()`, used to confirm arrival when
the sensor guess says no, with automatic fallback to the sensor bits on firmware
that does not implement FC1. `READER_SENSOR_MASK` remains as the single tunable
for the fast path.

### 1.6 Error frames were mostly invisible
`parseNFResponse()` matched only frames whose CM was `'F'` (it looked for the
bytes `"NF"`) and read the error code from the PM position. Per the SDK
(`if (recv[5] != 'P') return recv[8]`), any CM can carry an error and the code is
one byte later. Both fixed; `transact()` now logs decoded device errors.

### 1.7 `CheckSetting` sent a command that does not exist
`buildCheckSettingPacket()` sent the literal ASCII string `"CheckSetting"` as the
payload — the device NAKs it. The real command is **FR** (CM `'F'`, PM `'R'`).
Reimplemented as `getDeviceSettings()`, decoding front-entry mode and reset
behaviour.

### 1.8 Device address was hard-coded to 0
Only DIP address 0 (`0x30 0x30`) worked. Added `setAddress(0–15)` and
`detectAddress()`, which scans on connect if the current address is silent.
The SDK probes with RS — that *resets the mechanism*, so AP is used here instead.

### 1.9 Connection lifecycle
- A `disconnect` listener was added to `navigator.serial` on every connect and
  never removed → duplicate handlers after each reconnect.
- `attemptReconnect()` reopened the port without releasing reader/writer/port, so
  the reopen threw "port already open"; and both the USB-disconnect event and the
  5-failure watchdog could start it concurrently. Added `releasePort()` and a
  re-entrancy guard, plus a bail-out when the user disconnects manually.
- Writes no longer assume `writer` is non-null (`this.writer!` threw after a
  disconnect mid-flow).

### 1.10 Other
- FC7 and checkout step 3 now abort early on jam/overlap/fault instead of burning
  the full 12 s timeout.
- `parseAPStatusFromResponse()` could read past the payload into ETX/BCC, and its
  RF branch required 4 status bytes when RF returns 3.

## 2. Firestore

### 2.1 Rules and indexes pointed at collections that do not exist
`firestore.rules` guarded `card_issues`, `activity_logs`, `device_logs`;
the client writes `cardIssues`, `activityLogs`, `deviceLogs`. Unmatched paths are
denied by default, so **every** read and write failed against these rules and none
of the security intent applied. Renamed to match the client.

`firestore.indexes.json` had one index, on the wrong collection. Replaced with the
composite indexes the app's queries actually need (`issuedBy+issuedAt`,
`issuedById+issuedAt`, `status+issuedAt` on `cardIssues`; `deviceId+timestamp` on
`deviceLogs`).

### 2.2 Card-issue read rule was incompatible with the UI
Firestore rejects any *query* it cannot prove safe. The owner-only read rule
therefore broke the operator dashboard (`getAllCardIssues`) and the Visitor Exit
list (`status == "Issued"`, any issuer). Relaxed to any active user, with the
trade-off documented in the rules file.

## 3. App logic

### 3.1 Operator-issued cards were never recorded
`/dashboard/issue` called the device and wrote an activity log, but never created a
`cardIssues` document. The Visitor Exit tab reads `status == "Issued"`, so it stayed
empty forever and admin reports missed every card issued from that page. Now writes
`Processing` before touching the device and updates to `Issued`/`Failed` after,
matching the kiosk and the transaction-safety rules in `TESTING-CHECKLIST.md`.

### 3.2 Status polling could pile up
`setInterval(queryAP, 1000)` fired regardless of how long the previous poll took;
slow replies queued on the service lock. Replaced with a self-scheduling poll that
waits for each round-trip and skips while a flow owns the device.

### 3.3 Lint / React correctness (7 errors → 0)
Ref access during render in `k750-context`, `prefer-const` in `firestore-service`,
`setState` called synchronously inside effects (`admin/users`, `admin-login`),
service mutation from render scope (`admin/device`), unused imports.

## Verified

`npx tsc --noEmit` clean · `npm run build` succeeds · `npm run lint` 0 errors
(10 cosmetic warnings: unused `Brand`, `<img>` vs `next/image`) · 20 protocol unit
checks pass (frame bytes and BCC for AP/FC7/FC1/FR, address encoding 0/9/10/15,
FC1 decoding, error-frame decoding, AP nibble decoding including the `0x3F` case
from the vendor doc).

**Not verified against hardware** — no K750 is attached to this machine. Items
1.1–1.5 change real device behaviour and need a bench test.

## Open items (not changed — they need your decision)

1. **The kiosk cannot write to Firestore.** `/kiosk` has no auth guard and writes
   `issuedById: "kiosk"`, but the create rule requires `issuedById == request.auth.uid`
   from an active user. Either sign the kiosk in (anonymous auth or a dedicated
   service account) or put it behind an operator session.
2. **First-user-admin is missing.** `TESTING-CHECKLIST.md` expects the first
   registered user to become an admin; `register()` always assigns `role: "user"`,
   so a fresh deployment has no admin until Firestore is edited by hand.
3. **`.env.local` is committed** with the Firebase web config. Those keys are
   public by design, but the file should still be gitignored and the values set in
   the Vercel dashboard.
4. **README is stale** — it describes card mappings saved to `localStorage` and a
   single-page UI that no longer exist.
