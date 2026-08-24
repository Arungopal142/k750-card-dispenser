# K750 Card Dispenser — Next.js POC

A web-based proof-of-concept for issuing cards via a K750 card dispenser using the **Web Serial API** (`navigator.serial`).

## Hardware Setup

The K750 connects via RS232/USB-serial to the **local machine** running the browser.

**Important physical note:** The Minew MWC02 NFC card used with this device is ~1.6mm thick (the device is tuned for 0.76mm cards). **Set the 6-shift card-space adjustment accordingly** on the K750 before issuing.

## Requirements

- **Chrome or Edge** (Web Serial API required)
- Node.js 18+
- K750 card dispenser connected via USB-serial

## Serial Settings

- 9600 baud, 8 data bits, no parity, 1 stop bit
- Default DIP address (all ON): ADDH=0x30, ADDL=0x30

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in Chrome or Edge.

If the browser does not support Web Serial API, a warning banner will be displayed.

## Issue Flow

1. **Connect** — Select the K750 serial port from the browser dialog
2. **Dashboard** — View live device status (hopper, sensors, error bits)
3. **Fill form** — Enter Employee ID, Name, Department (max 16 chars each)
4. **Issue Card** — Button triggers the full flow:
   - FC7: dispense card to reader position
   - NFC read: detect chip type (auto: S50 → S70 → UL → TypeA) and read the UID
   - Save the card issue, including the UID, to Firestore
   - FC0: eject card
   - Show SUCCESS banner with UID

   A card with no readable chip still issues successfully — the NFC read is
   logged and skipped, not treated as a failure.

Admins can also read the UID of a card already at the reader from
**Admin → Device → Read NFC**.
5. **RS** — Reset device if errors occur

## Project Structure

```
types/web-serial.d.ts    — Web Serial API TypeScript declarations
lib/k750-protocol.ts     — Packet builder, BCC, status decoding
lib/k750-service.ts      — Serial I/O, device commands, issue flow
app/page.tsx             — UI (dashboard, form, debug log)
app/layout.tsx           — Dark theme layout
```

## Deploy to Vercel

1. Push this repository to GitHub (or GitLab/Bitbucket)

2. Install Vercel CLI (optional):
   ```bash
   npm i -g vercel
   ```

3. Deploy via CLI:
   ```bash
   vercel
   ```

4. Or deploy via the web:
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your Git repository
   - Vercel auto-detects Next.js — framework settings are pre-filled
   - Click **Deploy**

> **Note:** The app must run in a browser with Web Serial API support (Chrome/Edge) on a machine physically connected to the K750. Vercel serves the frontend; all serial communication happens client-side.

## Debug Log

Every TX/RX byte is logged with timestamps and hex values. Use the **Clear** button to reset the log. The log auto-scrolls.
