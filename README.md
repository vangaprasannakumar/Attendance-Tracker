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
- **Offline-first** architecture so factory floor punches are never lost during internet drops
- **Automated payroll engine** that calculates prorated salary, overtime, ESI, PF, VPF, and PT from live attendance data
- **One-click PDF payslips** printable directly from the app
- **Multi-tier role access** for Admin, HR, Standby kiosk, and Employee self-service

```
┌─────────────────────────────────────────────┐
│              FACTORY FLOOR                   │
│  Shared Tablet (Standby / Kiosk role)        │
│  Face Recognition → Punch IN / OUT           │
└────────────────┬────────────────────────────┘
                 │  HTTPS POST (JSON)
                 ▼
┌─────────────────────────────────────────────┐
│         Google Apps Script (Code.gs)         │
│  REST-like API · LockService · SHA-256 Auth  │
└────────────────┬────────────────────────────┘
                 │  SpreadsheetApp read/write
                 ▼
┌─────────────────────────────────────────────┐
│           Google Sheets (7 tabs)             │
│  Data · Users · List_of_Empl · Shifts        │
│  Audit_Log · H/S · OT_Empl                  │
└─────────────────────────────────────────────┘
```

---

## 2. Architecture

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | HTML / CSS / Vanilla JS | Single-file PWA — no build step required |
| AI | face-api.js (TinyFaceDetector) | Client-side facial recognition — no cloud API needed |
| Backend | Google Apps Script (doPost) | REST-like API with script locking and SHA-256 auth |
| Database | Google Sheets (7 tabs) | Zero-cost persistent storage with formula support |
| Offline | Service Worker + localStorage | Cache-first shell; pending punches queue auto-syncs |
| PDF | Browser `window.print()` | Payslip rendered to printable HTML; no PDF library needed |

---

## 3. File Structure

```
capco-hrms/
├── index.html       # Entire frontend — UI, styles, and all JS logic
├── manifest.json    # PWA manifest — icons, shortcuts, display config
├── sw.js            # Service Worker — caching, offline fallback, bg sync
└── Code.gs          # Google Apps Script backend — all API actions
```

> All four files are the complete system. There are no dependencies to install,
> no `node_modules`, no build pipeline.

---

## 4. Feature Reference

### 4.1 Manual Attendance Entry
- HR / Admin searches for an employee by name or ID using a live-filter dropdown
- Selects **Punch IN**, **Punch OUT**, **Mark Permission**, or **Mark Leave**
- Optional free-text remarks field for context
- Live status badge shows the employee's current state (IN / OUT / LEAVE / Not Punched) before action
- OT-category staff get a shift selector to override their default shift timing

### 4.2 AI Face Recognition Kiosk
- **Standby role** devices show only the kiosk UI — no other tabs visible
- Admin selects IN or OUT; camera activates
- `face-api.js TinyFaceDetector` scans every 600ms
- Matched employee is punched automatically — no touch required
- Text-to-speech announces: *"Thank you, [Name]. Punch IN successful."*
- 120-second inactivity timer auto-closes the camera; resets after each punch
- Unrecognised faces show a clear error; the person can retry after 5 seconds

### 4.3 Face Enrollment
- Admin navigates to **Employees** tab, finds the employee card, taps **Enroll Face**
- Camera opens; AI captures the face descriptor (128-float array) in real time
- Descriptor is saved to column Q of `List_of_Empl` sheet via API
- Face matcher rebuilds automatically — new employee is immediately recognisable

### 4.4 Offline Punch Queue
- If the device has no internet, punches are stored in `localStorage` with a full ISO timestamp
- A yellow toast confirms: *"Saved Offline — will sync when back online"*
- The `online` browser event fires sync automatically on reconnect
- Backend deduplicates by fingerprint `emplId|date|time|action` — replaying the queue never creates duplicate rows
- Result toast shows synced / skipped counts

### 4.5 Attendance History
- Search by **month**, **exact date**, or **employee name / ID** (or any combination)
- Single-employee view renders a compact table with date, shift, IN, OUT, OT columns and a total OT footer
- Multi-employee view renders cards
- Admin and HR see an **Edit** button on every row (changes are written to `Audit_Log`)

### 4.6 Payroll Engine
- Admin selects an employee and a month → **Generate Report**
- Engine reads attendance rows, counts present days, leaves, public holidays, and Sundays
- Prorates all salary components against payable days
- Calculates OT earnings: `(total OT hours) × (gross / working days / 8)`
- Deductions: ESI (0.75% if gross ≤ ₹21,000), PF (12% of basic), VPF (fixed), PT (slab-based)
- Renders full breakdown on screen and generates a print-ready payslip HTML

### 4.7 PDF Payslips
- **Download PDF Payslip** button writes the payslip HTML to a hidden `#print-section` div
- `window.print()` opens the browser print dialog targeting only that section
- Output is a clean A4 salary slip with company logo, earnings table, deductions, and net pay in words

### 4.8 Admin Leave Assignment
- Admin picks employee + date + reason → **Mark as Leave**
- Writes `LEAVE` to both IN and OUT columns on the Data sheet
- Deducts 1.0 from the employee's leave balance in `List_of_Empl`
- Audited in `Audit_Log`

### 4.9 Admin Dashboard
- Live count of: Total Staff, Present, Currently IN, Punched OUT, On Leave, Late Arrivals
- Late arrival = punch IN time is after shift start time
- **Export CSV** downloads the full month's attendance as a `.csv` file (base64-decoded in browser)

### 4.10 Employee Self-Service (ESS)
- Employees log in with their Employee ID as username
- Can view their own attendance history
- Can generate and download their own payslip for any month

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
| **Field** | Date | Day | Empl ID | Name | Shift | Shift Start | IN Time | *(spare)* | OUT Time | Total Hours | OT Hours | Permission | Remarks | Logged By | Flags |

> Columns J and K contain live formulas written by `applyFormulas()` in Code.gs.
> Column O stores processing flags like `SOT_BONUS_ADDED`.

---

### Tab: `List_of_Empl` (Employee Master)

| Col | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Field** | ID | Name | Shift | Category | Leave Bal | Gross | Basic | HRA | Conv | Spl | Med | ESI | PF | VPF | PT | PIN | Face Data |

> Column Q holds the JSON-serialised 128-float face descriptor. Leave blank until the employee is enrolled.

---

### Tab: `Users` (App Logins)

| Col | A | B | C | D |
|---|---|---|---|---|
| **Field** | Username | Role | Email | Password (SHA-256) |

---

### Tab: `Shifts`

| Col | A | B | C |
|---|---|---|---|
| **Field** | Shift Name | Start Time | End Time |

---

### Tab: `H/S` (Holiday / Sunday Config)

| Col | A | B | C |
|---|---|---|---|
| **Field** | Month Name | Working Days | Public Holidays |

---

### Tab: `OT_Empl` (OT Gross Override)

| Col | A | B | C |
|---|---|---|---|
| **Field** | Employee ID | Name | OT Gross (override) |

> Used when an employee's OT rate should differ from their standard gross. Leave blank to use gross from `List_of_Empl`.

---

### Tab: `Audit_Log`

| Col | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| **Field** | Timestamp | Admin User | Empl ID | Empl Name | Old Values | New Values |

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
4. Click **Deploy → New Deployment**
5. Set type to **Web App**
6. Set **Execute as**: Me
7. Set **Who has access**: Anyone
8. Copy the generated Web App URL

### Step 3 — Add the API URL to index.html

Open `index.html` and replace the placeholder on this line:

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

> The files have zero external build dependencies. No npm, no webpack, no framework.

### Step 6 — Add shifts and employees

1. Log in as Admin
2. Go to **Inventory → Employees → + Add New** to create employee records
3. Go to the `Shifts` tab directly in the Google Sheet to add shift definitions
4. Enroll faces for each employee from the **Employees** tab

---

## 8. Deployment Checklist

Run this checklist on every update:

- [ ] Updated `CACHE_NAME` date in `sw.js` (e.g. `capco-hrms-v4-20250502`)
- [ ] Re-deployed Google Apps Script as **New Deployment → Anyone**
- [ ] Updated `GOOGLE_API_URL` in `index.html` if a new script deployment was created
- [ ] Pushed updated files to the hosting location
- [ ] Hard-refreshed on one device to confirm SW updated (check DevTools → Application → Service Workers)
- [ ] Tested Punch IN and Punch OUT on a real device before announcing to staff

---

## 9. Offline & Sync Behaviour

```
Device goes offline
       │
       ▼
submitAttendance() detects !navigator.onLine
       │
       ▼
Punch saved to localStorage as:
{ emplId, emplName, action, remarks, loggedByUser, timestamp (ISO), shift }
       │
       ▼
Yellow toast: "Saved Offline — will sync when back online"
       │
Device comes back online
       │
       ▼
window 'online' event fires in index.html
       │
       ▼
callGoogleAPI({ action: 'syncOfflineData', pending: [...] })
       │
       ▼
Code.gs builds fingerprint Set from existing sheet rows:
"emplId|dd-MM-yyyy|HH:mm|action"
       │
       ├── Fingerprint exists → skip (duplicate)
       └── New fingerprint → logAttendance() → add to Set
       │
       ▼
Returns { synced: N, skipped: M }
localStorage cleared
Toast shows result
```

**Background Sync (Chrome / Android only):**
The Service Worker also registers a `sync` event listener for the tag `sync-punches`. The browser fires this even when the app tab is closed, providing a second layer of sync assurance on supported platforms.

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
- A descriptor distance below 0.55 is treated as a confirmed match
- Descriptors are stored as JSON arrays in column Q of `List_of_Empl`

### Enrollment flow
1. Camera opens
2. `detectSingleFace()` runs in a loop every 600ms
3. First clear detection captures the descriptor
4. Descriptor is JSON-stringified and POSTed to `saveFaceData`
5. Sheet is updated; `buildFaceMatcher()` rebuilds the matcher in memory

### Kiosk scan loop
- Scans every **600ms**
- `recentlyPunched[]` prevents the same person being logged twice in one session
- On error response from the server, the person is removed from `recentlyPunched` after **5 seconds** so they can retry
- Timer resets to **120 seconds** after each successful punch

---

## 11. Payroll Engine Logic

```
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

### OT Formula (Google Sheets column K)

```
=IF(OR(G="", I="", G="LEAVE"), "",
  LET(
    tMins, MOD(I-G,1)*1440,
    bMins, IF(OR(B="Sunday", COUNTIF('List of Holidays'!$A:$A, A)>0),
              30,
              IF(tMins>=720, 480, 510)),
    otMins, tMins - bMins,
    IF(otMins>0,
       IF(INT((otMins+5)/30)*30 > 0,
          INT((otMins+5)/30)*30/1440,
          ""),
       "")
  )
)
```

OT is rounded to the nearest 30-minute slot. Sunday/holiday baseline is 30 minutes; weekday baseline is 480 min (8 hrs) for shifts ≥ 720 min or 510 min otherwise.

---

## 12. Security Model

| Layer | Mechanism |
|---|---|
| Authentication | SHA-256 hashed passwords stored in `Users` sheet; plain-text auto-upgraded on first login |
| Concurrency | `LockService.waitLock(15000)` in `doPost` — prevents race conditions on simultaneous punches |
| Role enforcement | Backend validates `callerRole` before `deleteEmpl` and `deleteUser` actions |
| Audit trail | All admin edits and deletions written to `Audit_Log` with timestamp + username |
| API exposure | Google Apps Script URL is public but unauthenticated requests return no sensitive data without a valid `action` payload |
| Password visibility | `getAdminUsersData()` returns `***` for all password fields — hashes never reach the browser |
| Offline deduplication | Fingerprint-based Set prevents replay attacks from offline queue |

> **Note:** The `GOOGLE_API_URL` is visible in `index.html` source. Anyone who finds it can call the API directly. The security boundary is the `verifyLogin` action — all destructive actions require a verified `callerRole` passed from the frontend, which is only available after a successful login session. For higher security, consider adding a per-session token.

---

## 13. Known Limitations

| # | Limitation | Workaround |
|---|---|---|
| 1 | Google Apps Script has a **6-minute execution limit** per request — large `exportCSV` calls on very long history may time out | Export by month, not full history |
| 2 | `face-api.js` accuracy drops in poor lighting or with glasses/masks | Use good lighting at the kiosk; re-enroll with glasses if needed |
| 3 | iOS Safari does not support the **Background Sync API** | The `online` event listener in `index.html` covers iOS; punch still syncs when the user opens the app |
| 4 | Google Sheets has a **10 million cell limit** — with 50 employees punching twice daily, the Data sheet grows ~36,500 rows/year | Archive old months to a separate sheet annually |
| 5 | `GOOGLE_API_URL` is visible in page source | Acceptable for internal factory deployment; add token auth for public-facing use |
| 6 | Icons are hosted on `postimg.cc` | Self-host icons in the same repo for production reliability |

---

## 14. Upgrade History

### v4 — Current (Critical & Important fixes)

| Fix | File | Description |
|---|---|---|
| C1 | sw.js | `skipWaiting()` + `clients.claim()` — SW updates apply immediately on 24/7 kiosk |
| C2 | index.html | `online` event listener triggers `syncOfflineData` automatically on reconnect |
| C3 | Code.gs | `syncOfflineData` fingerprint deduplication — replaying queue never creates duplicates |
| C4 | Code.gs + index.html | `deleteEmpl` / `deleteUser` gated by role check; deletions audited |
| I1 | index.html | `hardRefreshApp` now calls `buildFaceMatcher()` — new enrollments activate immediately |
| I2 | index.html | Kiosk 120s timer resets after each successful punch |
| I3 | index.html | `recentlyPunched` cleared after 5s on error — retry without restarting session |
| I4 | Code.gs | Sunday counting uses a `Set` of unique dates — no more per-record double-counting |
| I5 | sw.js | `.catch(() => {})` replaced with proper `Response` objects; face-api.js pre-cached |
| I6 | manifest.json | 512px icon has separate `any` + `maskable` entries; `start_url` made absolute |
| I7 | index.html | `confirm()` dialog before marking leave from Entry tab |

### v3 — Previous
- Offline punch queue with `localStorage`
- SHA-256 password hashing with plain-text auto-upgrade
- Script lock concurrency protection
- AI kiosk with TinyFaceDetector
- PDF payslip via `window.print()`

---

## 15. Troubleshooting

**"API Permission Error. Re-deploy Google Script as 'Anyone'"**
→ The Apps Script deployment is set to restricted access. Go to Apps Script → Deploy → Manage Deployments → edit the deployment → change "Who has access" to **Anyone**.

---

**Face not being recognised at the kiosk**
→ Check: (1) Employee is enrolled — their card should show ✅ Enrolled. (2) Lighting is adequate. (3) The face matcher threshold of 0.55 may need lowering if false negatives are common — change it in `buildFaceMatcher()` in `index.html`.

---

**Offline punches not syncing**
→ Check `localStorage` in DevTools → Application → Local Storage for key `capco_pending_punches`. If it has data, reload the app while online. If the key is missing, the punch was never saved — check if the device was truly offline or if the API returned an error.

---

**Payslip shows ₹0 net pay**
→ Check: (1) Employee's salary fields in `List_of_Empl` are populated. (2) The selected month has attendance records in the `Data` sheet. (3) The `H/S` tab has an entry for that month.

---

**Service Worker not updating after deploy**
→ Open DevTools → Application → Service Workers → click **Update** or **Skip Waiting**. Ensure you bumped `CACHE_NAME` in `sw.js` before deploying.

---

**"Employee not found in Database" on payslip**
→ The Employee role username must exactly match the Employee ID in `List_of_Empl` column A. Check for leading/trailing spaces.

---

*Built for Capco Capacitor, Muppireddypally, Telangana.*
