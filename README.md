# Capco Master AI — HRMS

> **Zero-server, AI-powered factory attendance, payroll, and HR management system.**
> Built on Google Sheets + Google Apps Script + a PWA frontend. No recurring hosting costs.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [File Structure](#3-file-structure)
4. [Feature Reference](#4-feature-reference)
5. [User Roles](#5-user-roles)
6. [Google Sheet Structure](#6-google-sheet-structure)
7. [Setup & Deployment](#7-setup--deployment)
8. [Deployment Checklist](#8-deployment-checklist)
9. [Offline & Sync Behaviour](#9-offline--sync-behaviour)
10. [AI Face Recognition](#10-ai-face-recognition)
11. [Payroll Engine Logic](#11-payroll-engine-logic)
12. [Security Model](#12-security-model)
13. [Known Limitations](#13-known-limitations)
14. [Upgrade History](#14-upgrade-history)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. System Overview

Capco Master AI is a **Progressive Web App (PWA)** that runs entirely on Google infrastructure with zero recurring server costs. It replaces manual attendance registers and spreadsheet payroll with:

- **AI facial recognition** for fraud-proof punch IN / OUT at a shared kiosk
- **True Offline-first architecture** utilizing IndexedDB and the Background Sync API so factory floor punches are never lost, even if the browser tab is closed
- **Automated payroll engine** that dynamically calculates prorated salary, overtime, ESI, PF, VPF, and PT based on mathematical calendar models
- **One-click PDF payslips** printable directly from the app
- **Multi-tier role access** securely authenticated via short-lived Session Tokens (Admin, HR, Standby kiosk, and Employee self-service)

```text
┌─────────────────────────────────────────────┐
│              FACTORY FLOOR                  │
│  Shared Tablet (Standby / Kiosk role)       │
│  Face Recognition → Punch IN / OUT          │
└────────────────┬────────────────────────────┘
                 │  HTTPS POST (JSON)
                 ▼
┌─────────────────────────────────────────────┐
│         Google Apps Script (Code.gs)        │
│  REST-like API · LockService · SHA-256 Auth │
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
| AI | face-api.js (TinyFaceDetector) | Client-side facial recognition — no cloud API needed. |
| Backend | Google Apps Script (doPost) | REST-like API with script locking, session tokens, and cache chunking. |
| Database | Google Sheets (8 tabs) | Zero-cost persistent storage utilizing lightning-fast ArrayFormulas. |
| Offline | Service Worker + IndexedDB | Stale-while-revalidate shell; pending punches background auto-sync. |
| Export | Blob URLs & `window.print()` | Infinite-size CSV generation and PDF payslip rendering. |

---

## 3. File Structure

```text
capco-hrms/
├── index.html       # Entire frontend — UI, styles, AI, and JS logic
├── manifest.json    # PWA manifest — icons, intent-based shortcuts (?action=in)
├── sw.js            # Service Worker — caching, offline fallback, bg sync, IDB
└── Code.gs          # Google Apps Script backend — API actions and payroll math
```

> All four files represent the complete system. There are no dependencies to install, no `node_modules`, and no build pipeline.

---

## 4. Feature Reference

### 4.1 Manual Attendance Entry
- HR / Admin searches for an employee using a debounced, lag-free live-filter dropdown.
- Selects **Punch IN**, **Punch OUT**, **Mark Permission**, or **Mark Leave**.
- Optional free-text remarks field for context.
- Live status badge queries the database instantly to prevent duplicate punches.
- OT-category staff get a shift selector to override default timings.

### 4.2 AI Face Recognition Kiosk
- **Standby role** devices show only the kiosk UI.
- Admin selects IN or OUT; camera activates (with mobile autoplay bypass).
- `face-api.js TinyFaceDetector` scans every 150ms-600ms.
- Matched employee is punched automatically — no touch required.
- Text-to-speech announces: *"Thank you, [Name]. Punch IN successful."*
- 120-second inactivity timer auto-closes the camera.

### 4.3 Face Enrollment
- Admin finds the employee card, taps **Enroll Face**.
- Camera captures 5 distinct 128-float descriptors to ensure high accuracy.
- Descriptor is JSON-serialised and saved to column Q of `List_of_Empl`.
- `CacheService` chunking handles massive AI data payloads smoothly.

### 4.4 True Offline Background Sync
- If the factory loses internet, punches are saved directly to the browser's **IndexedDB**.
- The Service Worker registers a `sync` event.
- When the OS detects Wi-Fi—*even if the HRMS tab is closed*—the Service Worker wakes up, silently POSTs the punches to Google, and clears the local queue.
- Backend deduplicates via fingerprint (`emplId|date|time|action`) to guarantee zero duplicate rows.

### 4.5 Attendance History
- Search by **month**, **exact date**, or **employee name / ID**.
- Renders a compact table with total OT calculation.
- Admin and HR see an **Edit** button on every row to fix mistakes safely (writes to `Audit_Log`).

### 4.6 Salary Engine & Blob Export
- Computes perfect payroll logic including Ghost-Sunday-proof calendar mathematics.
- Generates beautiful HTML payslips.
- **Export CSV** utilizes a Blob URL string to bypass browser size limits, allowing infinite-scale data downloads without crashing.

---

## 5. User Roles

| Role | Entry | History | Payslip | Admin Panel | Kiosk |
|---|:---:|:---:|:---:|:---:|:---:|
| **Admin** | ✅ | ✅ (all) | — | ✅ Full | — |
| **HR** | ✅ | ✅ (all) | — | ✅ No user mgmt | — |
| **Employee** | — | ✅ Own only | ✅ Own | — | — |
| **Standby** | — | — | — | — | ✅ Only |

> Role names are **case-sensitive**. Type them exactly as shown when creating users.

---

## 6. Google Sheet Structure

### Tab: `Data` (Attendance Log)

| Col | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Field** | Date | Day | Empl ID | Name | Shift | Shift Start | IN Time | Shift End | OUT Time | Tot. Hrs | OT Hrs | Perm. | Remarks | Logged By | Flags |

> Columns J and K utilize high-performance `ARRAYFORMULA` in Row 1. Do not overwrite cells below Row 1 in these columns.

### Tab: `List_of_Empl` (Employee Master)

| Col | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Field** | ID | Name | Shift | Category | Leave Bal | Gross | Basic | HRA | Conv | Spl | Med | ESI | PF | VPF | PT | PIN | Face Data |

> Column Q holds the JSON-serialised 128-float face descriptor. Leave blank until the employee is enrolled.

### Tab: `Users` (App Logins)

| Col | A | B | C | D |
|---|---|---|---|---|
| **Field** | Username | Role | Email | Password (SHA-256) |

*(Tabs for `Shifts`, `H/S`, `OT_Empl`, `Audit_Log`, and `List of Holidays` remain standard).*

---

## 7. Setup & Deployment

### Step 1 — Create the Google Sheet

1. Create a new Google Sheet
2. Rename the default tab to `Data`
3. Add the following tabs (exact spelling matters):
   - `Users`
   - `List_of_Empl`
   - `Shifts`
   - `Audit_Log`
   - `H/S`
   - `OT_Empl`
4. Add a header row to each tab matching the column structure in §6
5. Add a separate sheet tab named `List of Holidays` with holidays in column A (date format `dd-MM-yyyy`) — used by the OT formula

### Step 2 — Deploy Code.gs

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete the default `myFunction()` code
3. Paste the full contents of `Code.gs`
4. Set your Script Properties: Add `APP_SECRET` for token generation.
5. Click **Deploy → New Deployment**
6. Set type to **Web App**
7. Set **Execute as**: Me
8. Set **Who has access**: Anyone
9. Copy the generated Web App URL

### Step 3 — Add the API URL to index.html & sw.js

Open `index.html` and `sw.js` and replace the placeholder on this line:

```javascript
const GOOGLE_API_URL = "YOUR_GOOGLE_SCRIPT_WEB_APP_URL_HERE";
```

with the URL you copied in Step 2.

### Step 4 — Create your first Admin user

Go to the `Users` tab in your Google Sheet and add a row manually:

| Username | Role | Email | Password |
|---|---|---|---|
| `admin` | `Admin` | `your@email.com` | `your_password_plaintext` |

On first login the app will automatically hash the password to SHA-256 and replace the plain text. After that, plain text is never stored again.

### Step 5 — Host the PWA files

Upload `index.html`, `manifest.json`, and `sw.js` to any static host:

- **GitHub Pages** (free) — push to a repo, enable Pages in Settings
- **Google Sites** — embed via raw HTML widget
- **Any web server** — copy the three files to the document root

### Step 6 — Add shifts and employees

1. Log in as Admin
2. Go to **Inventory → Employees → + Add New** to create employee records
3. Go to the `Shifts` tab directly in the Google Sheet to add shift definitions
4. Enroll faces for each employee from the **Employees** tab

---

## 8. Deployment Checklist

Run this checklist on every update:

- [ ] Updated `CACHE_DATE` in `sw.js` (e.g. `20260422` forces clients to download the new build)
- [ ] Re-deployed Google Apps Script as **New Deployment → Anyone**
- [ ] Updated `GOOGLE_API_URL` in `index.html` and `sw.js` if a new script deployment was created
- [ ] Pushed updated files to the hosting location
- [ ] Ensured `ARRAYFORMULA` is pasted in `Data` sheet cells J1 and K1
- [ ] Tested Punch IN and Punch OUT on a real device before announcing to staff

---

## 9. Offline & Sync Behaviour

Because factories frequently suffer from internet drops, the system is designed to be indestructible offline.

1. Device goes offline.
2. `submitAttendance()` writes the punch to **IndexedDB**.
3. A `sync-punches` tag is registered with the OS via `SyncManager`.
4. Even if the user minimizes the browser, when the OS regains Wi-Fi, it wakes up `sw.js`.
5. `sw.js` reads IndexedDB and POSTs the payload to `Code.gs`.
6. `Code.gs` checks fingerprints (`emplId|date|time|action`). It drops duplicates and commits the fresh punches.

**Background Sync (Chrome / Android only):**
The Service Worker registers a `sync` event listener. The browser fires this even when the app tab is closed, providing a second layer of sync assurance on supported platforms.

---

## 10. AI Face Recognition

### Model
`face-api.js v0.22.2` — runs entirely in the browser using WebGL acceleration.

Three sub-models are loaded:

| Model | Purpose |
|---|---|
| `tinyFaceDetector` | Detect face bounding box (fast, low-resource) |
| `faceLandmark68Net` | Locate 68 facial landmarks |
| `faceRecognitionNet` | Generate 128-dimension face descriptor |

### Matching
- `FaceMatcher` threshold: **0.55** (lower = stricter; range 0–1)
- Descriptors are stored as JSON arrays in column Q of `List_of_Empl`

### Enrollment flow
1. Camera opens
2. `detectSingleFace()` runs in a loop every 600ms
3. Camera captures 5 distinct 128-float descriptors to ensure high accuracy
4. Descriptor is JSON-stringified and POSTed to `saveFaceData`
5. Sheet is updated; `buildFaceMatcher()` rebuilds the matcher in memory

---

## 11. Payroll Engine Logic

The engine does not rely on flawed database lookups to determine calendar days. It utilizes an internal JavaScript loop to calculate exact Sundays and month days mathematically.

```text
Payable Days = Present Days + Public Holidays + Sundays in month
(capped at total working days in month)

Proration Factor = Payable Days / Total Days in Month

Prorated Component = Round(Fixed Component × Factor)

OT Per Hour = Round(OT Gross / Total Days / 8, 2)
OT Earnings  = Total OT Hours × OT Per Hour

ESI          = Prorated Gross × 0.0075   (only if Gross ≤ ₹21,000)
PF           = Prorated Basic × 0.12
VPF          = Fixed from employee record
PT           = ₹200 if Gross ≥ ₹20,000
             = ₹150 if Gross ≥ ₹15,000
             = ₹0   otherwise

Net Pay = Prorated Gross + OT Earnings − (ESI + PF + VPF + PT)
```

### Employee Categories

| Category | OT Calculated | SOT Bonus |
|---|:---:|:---:|
| Staff Without OT | ❌ | ❌ |
| Staff With OT | ✅ | ❌ |
| Staff With SOT | ✅ | ✅ (+0.5 leave if ≥ 12 hrs worked) |

---

## 12. Security Model

| Layer | Mechanism |
|---|---|
| Authentication | Passwords upgraded to SHA-256 hashes on first login. |
| Session Tokens | `Code.gs` issues a 6-hour expiring token stored in `CacheService`. All destructive API calls require a validated token. |
| Concurrency | `LockService.waitLock(15000)` in `doPost` — prevents race conditions on simultaneous punches |
| Role enforcement | Backend validates `callerRole` before `deleteEmpl` and `deleteUser` actions |
| Audit trail | All admin edits and deletions written to `Audit_Log` with timestamp + username |
| Password visibility | `getAdminUsersData()` returns `***` for all password fields — hashes never reach the browser |

---

## 13. Known Limitations

| # | Limitation | Workaround |
|---|---|---|
| 1 | Google Apps Script has a **6-minute execution limit** per request — large `exportCSV` calls on very long history may time out | Export by month, not full history |
| 2 | `face-api.js` accuracy drops in poor lighting or with glasses/masks | Use good lighting at the kiosk; re-enroll with glasses if needed |
| 3 | iOS Safari does not support the **Background Sync API** | The `online` event listener in `index.html` covers iOS; punch still syncs when the user opens the app |
| 4 | Google Sheets has a **10 million cell limit** | Archive old months to a separate sheet annually |
| 5 | ArrayFormula Space | Google Sheets `ARRAYFORMULA` will break if there is manual text entered below row 1 in the J/K columns. |

---

## 14. Upgrade History

### v6 — Current (Enterprise Refactor)
- **IndexedDB Sync:** `localStorage` replaced with IDB. Service worker now syncs punches seamlessly while closed.
- **Session Tokens:** Complete backend lock-down using `CacheService` validation keys.
- **Ghost Sunday Fix:** Month-looping logic added to ensure un-punched Sundays are properly credited for payroll.
- **Blob CSV Export:** Base64 Data URI replaced with Blob Object URLs to allow infinite-scale data downloads.
- **Cache Chunking:** AI Descriptors exceeding Google's 100KB limit are now sliced, cached, and reassembled transparently.
- **CSS Transform Zoom:** Zoom controls rebuilt for flawless scaling across fixed-position grids.
- **ArrayFormulas:** Heavy scripting removed from backend sheet loops to maximize speed.
- **Safe CSVs:** Escaped quotes added to Remarks to prevent spreadsheet injection breaks.
- **Manifest Intents:** `?action=in` shortcut parameters open kiosk states dynamically.

### v4 / v5 — Legacy
- Script lock concurrency protection
- PDF payslip via `window.print()`
- Basic offline queueing
- SHA-256 implementation

---

## 15. Troubleshooting

**"API Permission Error. Re-deploy Google Script as 'Anyone'"**
→ The Apps Script deployment is set to restricted access. Go to Apps Script → Deploy → Manage Deployments → edit the deployment → change "Who has access" to **Anyone**.

---

**Face not being recognised at the kiosk**
→ Check: (1) Employee is enrolled — their card should show ✅ Enrolled. (2) Lighting is adequate. (3) The face matcher threshold of 0.55 may need lowering if false negatives are common — change it in `buildFaceMatcher()` in `index.html`.

---

**Offline punches not syncing**
→ Check `IndexedDB` in DevTools → Application → IndexedDB for `CapcoOfflineDB`. If it has data, reload the app while online. If it is empty, the punch was never saved — check if the device was truly offline or if the API returned an error.

---

**Payslip shows ₹0 net pay**
→ Check: (1) Employee's salary fields in `List_of_Empl` are populated. (2) The selected month has attendance records in the `Data` sheet. (3) The `H/S` tab has an entry for that month.

---

**Service Worker not updating after deploy**
→ Open DevTools → Application → Service Workers → click **Update** or **Skip Waiting**. Ensure you bumped `CACHE_DATE` in `sw.js` before deploying.

---

**"Employee not found in Database" on payslip**
→ The Employee role username must exactly match the Employee ID in `List_of_Empl` column A. Check for leading/trailing spaces.

---

*Built for Capco Capacitor, Muppireddypally, Telangana.*
```
