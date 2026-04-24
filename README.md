# 🏢 Capco HRMS & AI Attendance System

> **Zero-server, AI-powered factory attendance, payroll, and HR management system.** > Built on Google Sheets + Google Apps Script + a PWA frontend. No recurring hosting costs.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [File Structure](#3-file-structure)
4. [Feature Reference](#4-feature-reference)
5. [User Roles](#5-user-roles)
6. [Google Sheet Structure](#6-google-sheet-structure)
7. [API Keys & Secrets — How to Configure](#7-api-keys--secrets--how-to-configure)
8. [Setup & Deployment](#8-setup--deployment)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Offline & Sync Behaviour](#10-offline--sync-behaviour)
11. [AI Face Recognition](#11-ai-face-recognition)
12. [Payroll Engine Logic](#12-payroll-engine-logic)
13. [Security Model](#13-security-model)
14. [Latest Upgrades & Fixes](#14-latest-upgrades--fixes)
15. [Known Limitations](#15-known-limitations)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. System Overview

Capco Master AI is a **Progressive Web App (PWA)** that runs entirely on Google infrastructure with zero recurring server costs. Designed for high-speed factory environments, it replaces manual attendance registers and spreadsheet payroll with:

- **Instant AI facial recognition** with live canvas bounding-box tracking for fraud-proof punch IN / OUT at a shared kiosk.
- **True Offline-first architecture** utilizing IndexedDB and the Background Sync API so factory floor punches are never lost, even if the browser tab is closed.
- **Automated payroll engine** that dynamically calculates prorated salary, overtime, ESI, PF, VPF, and PT based on mathematical calendar models.
- **Native PDF payslips** printable directly from the app with crisp vector text.
- **Multi-tier role access** securely authenticated via short-lived Session Tokens (Admin, HR, Standby kiosk, and Employee self-service).
- **Live dashboard** featuring visual Enrolled Staff Avatars and instant Excel matrix exports.
- **Employee correction requests** — a complete workflow for employees to flag incorrect attendance for HR/Admin review.

```text
┌─────────────────────────────────────────────┐
│              FACTORY FLOOR                  │
│  Shared Tablet (Standby / Kiosk role)       │
│  Instant Face Recognition + Bounding Box    │
│  Auto-Punch IN / OUT (No blink required)    │
└────────────────┬────────────────────────────┘
                 │  HTTPS POST (JSON)
                 ▼
┌─────────────────────────────────────────────┐
│         Google Apps Script (Code.gs)        │
│  REST-like API · LockService · SHA-256 Auth │
│  Script Properties (APP_SECRET stored here) │
└────────────────┬────────────────────────────┘
                 │  SpreadsheetApp read/write
                 ▼
┌─────────────────────────────────────────────┐
│            Google Sheets (8 tabs)           │
│  Data · Users · List_of_Empl · Shifts       │
│  Audit_Log · H/S · OT_Empl · Holidays       │
└─────────────────────────────────────────────┘
```

---

## 2. Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML / CSS / Vanilla JS | Single-file PWA — no build step required, responsive CSS transforms. |
| AI | face-api.js (TinyFaceDetector) | Client-side facial recognition — processes instantly via WebGL. |
| Backend | Google Apps Script (doPost) | REST-like API with script locking, session tokens, and cache chunking. |
| Database | Google Sheets (8 tabs) | Zero-cost persistent storage utilizing lightning-fast ArrayFormulas. |
| Offline | Service Worker + IndexedDB | Stale-while-revalidate shell; pending punches background auto-sync. |
| Export | ExcelJS & Native `window.print` | High-quality Excel matrices and native crisp PDF generation. |
| Secrets | Google Script Properties | `APP_SECRET` stored server-side, never exposed to the browser. |

---

## 3. File Structure

```text
capco-hrms/
├── index.html       # Entire frontend — UI, styles, AI, canvas overlays, and JS logic
├── manifest.json    # PWA manifest — icons, intent-based shortcuts
├── sw.js            # Service Worker — caching, offline fallback, bg sync, IDB
└── Code.gs          # Google Apps Script backend — API actions and payroll math
```

> All four files represent the complete system. There are no dependencies to install, no `node_modules`, and no build pipeline.

---

## 4. Feature Reference

### 4.1 Manual Attendance Entry
- HR / Admin searches for an employee using a debounced, lag-free live-filter dropdown.
- Selects **Punch IN**, **Punch OUT**, **Mark Permission**, or **Mark Leave**.
- Leave confirmation dialog shows the **employee's exact current leave balance** before deducting.
- Optional free-text remarks field for context.
- Live status badge queries the database instantly to prevent duplicate punches.

### 4.2 AI Face Recognition Kiosk (Instant-Scan Mode)
- **Standby role** devices show only the kiosk UI.
- Admin selects IN or OUT; camera activates (with mobile autoplay and `webkit-playsinline` bypasses).
- **Live Canvas Tracking:** A blue bounding box draws directly over the recognized face with the employee's name.
- **Instant Recognition:** The system punches the employee immediately upon threshold match (No blinking required, optimized for factory speed).
- Text-to-speech announces: *"[Employee Name]"* to confirm.
- **Countdown timer:** 120-second visible timer displayed live so the kiosk operator knows when it auto-closes.

### 4.3 Face Enrollment
- Admin finds the employee card, taps **Enroll Face** (or **🔄 Re-enroll Face** if already enrolled).
- Live canvas box tracks the face to ensure good lighting.
- Camera captures 5 distinct 128-float descriptors.
- Descriptor is JSON-serialised and saved to column Q of `List_of_Empl`.

### 4.4 True Offline Background Sync
- If the factory loses internet, punches are saved directly to the browser's **IndexedDB**.
- The Service Worker registers a `sync` event.
- When the OS detects Wi-Fi, it silently POSTs the punches to Google and clears the local queue.
- Backend deduplicates via fingerprint (`emplId|date|time|action`) to guarantee zero duplicate rows.

### 4.5 Attendance History & Requests
- Search by **month**, **exact date**, or **employee name / ID**.
- **Export Filtered View:** Convert the exact on-screen filtered results directly to a CSV.
- **Employee Correction Requests:** Employees can click **"Req Edit"** on their history. This opens a modal to describe the issue. The request is pushed to a dedicated **Requests** tab for HR to review and resolve.

### 4.6 Salary Engine & PDF Payslips
- Computes perfect payroll logic including Ghost-Sunday-proof calendar mathematics.
- Generates precise HTML payslips with OT, deductions, and word-converted net pay.
- **Native PDF Printing:** Uses the browser's native `window.print()` engine to ensure PDFs are downloaded as crisp, selectable text documents, completely replacing blurry screenshot-based libraries.

### 4.7 Live Admin Dashboard
- Live total staff, present, currently in, out, leave, and late arrival stats.
- **Enrolled Avatars:** A horizontally scrolling UI showing circular, Apple-style initial avatars for every employee who has successfully registered their face.
- **Monthly Excel Matrix:** Uses `exceljs` to generate a frozen-pane attendance matrix with live Leave (EL), Present (P), and Absent (A) markers.

---

## 5. User Roles

| Role | Entry | History | Payslip | Correction Request | Admin Panel | Kiosk |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Admin** | ✅ | ✅ (all) | — | ✅ Resolve | ✅ Full | — |
| **HR** | ✅ | ✅ (all) | — | ✅ Resolve | ✅ No user mgmt | — |
| **Employee** | — | ✅ Own only | ✅ Own | ✅ Submit | — | — |
| **Standby** | — | — | — | — | — | ✅ Only |

> Role names are **case-sensitive**. Type them exactly as shown when creating users.

---

## 6. Google Sheet Structure

### Tab: `Data` (Attendance Log)
*(Columns A through O)*: Date, Day, Empl ID, Name, Shift, Shift Start, IN Time, Shift End, OUT Time, Tot. Hrs, OT Hrs, Perm., Remarks, Logged By, Flags.
> *Columns J and K use `ARRAYFORMULA` in Row 1. The backend automatically targets the first truly empty row in Column C to bypass ghost rows.*

### Tab: `List_of_Empl` (Employee Master)
*(Columns A through Q)*: ID, Name, Shift, Category, Leave Bal, Gross, Basic, HRA, Conv, Spl, Med, ESI, PF, VPF, PT, PIN, Face Data.

### Tab: `Users` (App Logins)
*(Columns A through D)*: Username, Role, Email, Password (SHA-256).

---

## 7. API Keys & Secrets — How to Configure

### 7.1 The Google Apps Script Web App URL (`GOOGLE_API_URL`)
This public-facing HTTPS endpoint routes the PWA to your Sheet.
Paste this URL in **two files**:
* **`index.html`** (near the top of the `<script>` tag)
* **`sw.js`** (top of the file)

### 7.2 The `APP_SECRET` (Session Token Signing Key)
This **is a true secret**. It must **never** be placed in the frontend.
1. In Apps Script editor → click **⚙️ Project Settings**
2. Scroll to **Script Properties** → **Add script property**
3. Property name: `APP_SECRET`
4. Value: *[Your secure random string]*

---

## 8. Setup & Deployment

1. Create a new Google Sheet with the exact 8 tabs required.
2. In Google Sheets, go to **Extensions → Apps Script**.
3. Paste `Code.gs`, add your `APP_SECRET`, and click **Deploy → New Deployment** (Web App, Me, Anyone).
4. Copy the Web App URL and paste it into `index.html` and `sw.js`.
5. Create an `Admin` user manually in the `Users` tab (plaintext password will hash on first login).
6. Host `index.html`, `manifest.json`, and `sw.js` on GitHub Pages or any static host.

---

## 9. Deployment Checklist

- [ ] Bumped `CACHE_DATE` in `sw.js` (e.g. `20260424`).
- [ ] Re-deployed Google Apps Script as **New Deployment → Anyone**.
- [ ] Updated `GOOGLE_API_URL` in **both** `index.html` and `sw.js`.
- [ ] Confirmed `ARRAYFORMULA` exists in `Data` sheet cells J1 and K1.
- [ ] Verified `APP_SECRET` is configured in Script Properties.

---

## 10. Offline & Sync Behaviour

1. Device goes offline; `submitAttendance()` writes the punch to **IndexedDB**.
2. A `sync-punches` tag is registered with the OS via `SyncManager`.
3. When the OS regains Wi-Fi, `sw.js` silently POSTs the payload to `Code.gs`.
4. `Code.gs` deduplicates via fingerprint (`emplId|date|time|action`).
*Note: iOS Safari does not support Background Sync API. Fallback `online` event listeners push data instantly when the app is opened.*

---

## 11. AI Face Recognition

### Model Details
Uses `face-api.js v0.22.2`. Runs entirely in-browser. Zero cloud calls.
* **Detection:** `TinyFaceDetector` with `inputSize: 320` and `scoreThreshold: 0.3` (Optimized for high-resolution mobile cameras and factory lighting).
* **Matching:** `FaceMatcher` strictness threshold is set to **0.6**.
* **Tracking:** A `<canvas>` layer accurately tracks the face coordinates in real-time, drawing a visual bounding box for user feedback.

### Instant-Scan Mode
Liveness/Blink detection has been stripped in favor of raw factory speed. If the 128-dimension mathematical descriptor maps to an enrolled employee, the punch is logged instantly.

---

## 12. Payroll Engine Logic

```text
Payable Days = Present Days + Public Holidays + Sundays in month
Proration Factor = Payable Days / Total Days in Month

OT Per Hour = Round(OT Gross / Total Days / 8, 2)
OT Earnings  = Total OT Hours × OT Per Hour

ESI = Prorated Gross × 0.0075   (only if Gross ≤ ₹21,000)
PF  = Prorated Basic × 0.12
PT  = ₹200 (Gross ≥ ₹20,000) | ₹150 (Gross ≥ ₹15,000) | ₹0

Net Pay = Prorated Gross + OT Earnings − (ESI + PF + VPF + PT)
```

---

## 13. Security Model

* **Passwords:** Hashed via SHA-256 on the client before being checked. Plaintext is never retained.
* **Tokens:** 5.5-hour expiring JWT-style tokens stored in `CacheService`.
* **Concurrency:** `LockService.waitLock(15000)` prevents duplicate punches during heavy shift changes.
* **Audit Trail:** Admin edits and Employee Correction Requests are immutably written to `Audit_Log`.

---

## 14. Latest Upgrades & Fixes

* **Native PDF Payslips:** Replaced blurry mobile canvas renders with raw `window.print()` functionality for crisp, vector-grade PDFs.
* **Instant-Scan Face Tracking:** Removed the blink requirement for maximum speed. Added a live blue canvas bounding box overlay to visibly track faces during enrollment and punching.
* **Dashboard Avatars:** Added a horizontally scrolling UI in the Admin Dashboard showing circular avatars with initials for all enrolled staff.
* **Employee Correction Requests:** Employees can submit "Req Edit" flags from their history, populating a dedicated **Requests** tab for HR review.
* **Smart Leave Balances:** The leave confirmation dialog now outputs the exact current leave balance of the employee before executing the deduction.
* **Filtered Export:** Added an "Export View (CSV)" button that perfectly downloads currently filtered history results.
* **Toast Queuing:** Fixed overlapping success/error messages by introducing a strict 3-message sequential array queue.
* **Ghost Row Bypass:** Fixed a major bug where `appendRow()` jumped to row 65 due to ArrayFormulas. The backend now mathematically calculates the true last row via Column C iteration.

---

## 15. Known Limitations

1. **Google Apps Script 6-minute execution limit:** Massive full-year CSV exports may time out. Filter by month.
2. **iOS Safari:** Background Sync API is unsupported; requires the app to be open to sync pending offline queues.
3. **Face API Mobile Fallbacks:** WebGL/GPU rendering relies on the mobile device's chipset. If blocked by battery savers, the CPU fallback may experience lower frame rates.

---

## 16. Troubleshooting

* **"API Permission Error" / "Session Expired" immediately:** Re-deploy the Google Script as a **New Deployment** and verify `Who has access` is set to **Anyone**. Update the URL in `index.html`.
* **Camera frozen on "Starting Camera..."** Ensure the site is hosted on a secure `HTTPS` context. Mobile browsers block camera access on standard HTTP.
* **PDF generating as a full webpage print:** This is the intended native behavior for mobile OS limitations. The CSS `@media print` query strips away the UI to leave only the payslip document.

---
*Built for Capco Capacitor, Muppireddypally, Telangana. v8 — April 2026.*
