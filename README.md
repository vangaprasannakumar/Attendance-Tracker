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
7. [API Keys & Secrets — How to Configure](#7-api-keys--secrets--how-to-configure)
8. [Setup & Deployment](#8-setup--deployment)
9. [Deployment Checklist](#9-deployment-checklist)
10. [Offline & Sync Behaviour](#10-offline--sync-behaviour)
11. [AI Face Recognition](#11-ai-face-recognition)
12. [Payroll Engine Logic](#12-payroll-engine-logic)
13. [Security Model](#13-security-model)
14. [Bug Fixes Applied — v7](#14-bug-fixes-applied--v7)
15. [Upgrades Applied — v7](#15-upgrades-applied--v7)
16. [Known Limitations](#16-known-limitations)
17. [Upgrade History](#17-upgrade-history)
18. [Troubleshooting](#18-troubleshooting)

---

## 1. System Overview

Capco Master AI is a **Progressive Web App (PWA)** that runs entirely on Google infrastructure with zero recurring server costs. It replaces manual attendance registers and spreadsheet payroll with:

- **AI facial recognition with liveness detection** (blink-to-confirm) for fraud-proof punch IN / OUT at a shared kiosk
- **PIN fallback** on the kiosk when face recognition fails — uses existing PIN field, no extra setup
- **True Offline-first architecture** utilizing IndexedDB and the Background Sync API so factory floor punches are never lost, even if the browser tab is closed
- **Automated payroll engine** that dynamically calculates prorated salary, overtime, ESI, PF, VPF, and PT based on mathematical calendar models
- **One-click PDF payslips** printable directly from the app
- **Multi-tier role access** securely authenticated via short-lived Session Tokens (Admin, HR, Standby kiosk, and Employee self-service)
- **Live dashboard auto-refresh** with 30-second polling and last-updated timestamp
- **Employee correction requests** — employees can flag incorrect attendance for HR/Admin review

```text
┌─────────────────────────────────────────────┐
│              FACTORY FLOOR                  │
│  Shared Tablet (Standby / Kiosk role)       │
│  Face Recognition + PIN Fallback            │
│  Blink-to-confirm → Punch IN / OUT          │
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
| AI | face-api.js (TinyFaceDetector) | Client-side facial recognition — no cloud API needed. |
| Backend | Google Apps Script (doPost) | REST-like API with script locking, session tokens, and cache chunking. |
| Database | Google Sheets (8 tabs) | Zero-cost persistent storage utilizing lightning-fast ArrayFormulas. |
| Offline | Service Worker + IndexedDB | Stale-while-revalidate shell; pending punches background auto-sync. |
| Export | Blob URLs & `window.print()` | Infinite-size CSV generation and PDF payslip rendering. |
| Secrets | Google Script Properties | `APP_SECRET` stored server-side, never exposed to the browser. |

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
- Leave confirmation dialog now shows the **employee's current leave balance** before deducting, so HR is never surprised by a negative balance.
- Optional free-text remarks field for context.
- Live status badge queries the database instantly to prevent duplicate punches.
- OT-category staff get a shift selector to override default timings.

### 4.2 AI Face Recognition Kiosk
- **Standby role** devices show only the kiosk UI.
- Admin selects IN or OUT; camera activates (with mobile autoplay bypass).
- `face-api.js TinyFaceDetector` scans every 150ms–600ms (adaptive).
- **Blink-to-confirm liveness**: system identifies the employee, then asks them to blink. Eyes closing (EAR < 0.25) then opening again completes the punch. Prevents photo spoofing.
- **PIN Fallback**: if the camera fails to recognize a face after 3 consecutive failed attempts, the kiosk automatically shows a numeric PIN pad. Employee enters their 4-digit PIN to punch. The PIN is stored in column P of `List_of_Empl` (set it per employee in the Admin panel).
- **Countdown timer on screen**: remaining seconds displayed live so the kiosk operator knows when it auto-closes.
- Text-to-speech announces: *"Thank you, [Name]. Punch IN successful."*
- 120-second inactivity timer auto-closes the camera.

### 4.3 Face Enrollment
- Admin finds the employee card, taps **Enroll Face** (or **Re-enroll Face** if already enrolled — the button now shows the correct label).
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
- **Export current view**: a new "Export This View" button exports exactly what is shown on screen (filtered by employee + date range) as a CSV — not just a full-month dump.
- **Employee correction requests**: Employee-role users see a **"Request Correction"** button on their own history rows. Clicking it logs a correction request entry into `Audit_Log` tagged as `CORRECTION_REQUEST`. Admin/HR see these flagged in the Audit section.

### 4.6 Salary Engine & Blob Export
- Computes perfect payroll logic including Ghost-Sunday-proof calendar mathematics.
- Generates beautiful HTML payslips.
- **Export CSV** utilizes a Blob URL string to bypass browser size limits, allowing infinite-scale data downloads without crashing.

### 4.7 Live Dashboard
- Dashboard stats auto-refresh every **30 seconds** without any user action.
- A **"Last refreshed X mins ago"** label is shown under the stats grid so operators always know how fresh the data is.
- Manual refresh button still available via the top-right icon.

### 4.8 Toast Notification Queue
- Multiple rapid actions (e.g., saving employee + reloading) no longer stack overlapping toast banners.
- Toast messages now queue up to 3 items and display them sequentially, one after the other.

---

## 5. User Roles

| Role | Entry | History | Payslip | Correction Request | Admin Panel | Kiosk |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Admin** | ✅ | ✅ (all) | — | ✅ See all | ✅ Full | — |
| **HR** | ✅ | ✅ (all) | — | ✅ See all | ✅ No user mgmt | — |
| **Employee** | — | ✅ Own only | ✅ Own | ✅ Submit | — | — |
| **Standby** | — | — | — | — | — | ✅ Only |

> Role names are **case-sensitive**. Type them exactly as shown when creating users.

---

## 6. Google Sheet Structure

### Tab: `Data` (Attendance Log)

| Col | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Field** | Date | Day | Empl ID | Name | Shift | Shift Start | IN Time | Shift End | OUT Time | Tot. Hrs | OT Hrs | Perm. | Remarks | Logged By | Flags |

> Columns J and K use `ARRAYFORMULA` in Row 1. Do not overwrite cells below Row 1 in these columns.

### Tab: `List_of_Empl` (Employee Master)

| Col | A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Field** | ID | Name | Shift | Category | Leave Bal | Gross | Basic | HRA | Conv | Spl | Med | ESI | PF | VPF | PT | PIN | Face Data |

> **Column P (PIN):** 4-digit numeric PIN for kiosk fallback. Set it per employee in the Admin panel Employee modal. Leave blank to disable PIN fallback for that employee.  
> **Column Q (Face Data):** JSON-serialised 128-float face descriptor. Leave blank until enrolled.

### Tab: `Users` (App Logins)

| Col | A | B | C | D |
|---|---|---|---|---|
| **Field** | Username | Role | Email | Password (SHA-256) |

*(Tabs for `Shifts`, `H/S`, `OT_Empl`, `Audit_Log`, and `List of Holidays` remain standard.)*

---

## 7. API Keys & Secrets — How to Configure

This is the most important section for a fresh deployment or re-deployment. There are **two types of secrets** this project uses and they are stored in completely different places by design.

---

### 7.1 The Google Apps Script Web App URL (`GOOGLE_API_URL`)

This is **not a secret** — it is a public-facing HTTPS endpoint that Google generates when you deploy your script. It is safe to commit to GitHub because the script itself enforces session token authentication on every request.

**Where to set it:**

You must paste this URL in **two files**:

**File 1 — `index.html`** (line ~716):
```javascript
const GOOGLE_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

**File 2 — `sw.js`** (line ~6):
```javascript
const GOOGLE_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

> ⚠️ If you forget to update `sw.js`, the Service Worker's background sync will silently fail even though the main app works fine. Always update both.

**How to get this URL:**
1. In your Google Sheet → **Extensions → Apps Script**
2. Click **Deploy → New Deployment**
3. Type: **Web App**
4. Execute as: **Me**
5. Who has access: **Anyone**
6. Click **Deploy** → Copy the URL

Every time you make changes to `Code.gs` you must create a **New Deployment** (not edit the existing one) and update both files above with the new URL.

---

### 7.2 The `APP_SECRET` (Session Token Signing Key)

This **is a true secret**. It is the server-side key used to salt the SHA-256 session tokens. It must **never** be placed in `index.html`, `sw.js`, or any file that gets served to browsers.

**It lives exclusively inside Google Apps Script Properties — it never touches the frontend.**

**How to set it:**

1. In Apps Script editor → click the **⚙️ Project Settings** icon (gear icon, left sidebar)
2. Scroll down to **Script Properties**
3. Click **Add script property**
4. Property name: `APP_SECRET`
5. Value: any long random string — e.g. `capco-factory-2025-xK9#mPqR7!`
6. Click **Save script properties**

```
Script Properties
┌──────────────┬────────────────────────────────────┐
│ Property     │ Value                              │
├──────────────┼────────────────────────────────────┤
│ APP_SECRET   │ capco-factory-2025-xK9#mPqR7!      │
└──────────────┴────────────────────────────────────┘
```

> If `APP_SECRET` is missing, `Code.gs` falls back to a hardcoded default string (`capco-internal-2025`). **This is a security risk.** Always set a custom `APP_SECRET` in production.

**Why this approach is secure:**

| What | Where stored | Visible to browser? |
|---|---|---|
| `GOOGLE_API_URL` | `index.html` + `sw.js` | ✅ Yes — intentional, it's a public endpoint |
| `APP_SECRET` | Google Script Properties | ❌ Never — server-side only |
| Session Token | Browser `localStorage` | ✅ Yes — but it's a one-way hash, not the secret itself |
| Passwords | Google Sheet column D | ❌ Never — only SHA-256 hash stored |

---

### 7.3 What About Face API Keys?

`face-api.js` runs **100% in the browser** using pre-trained model weights served from jsDelivr CDN. It has **no API key, no account, and no usage quota**. No configuration needed.

---

### 7.4 Summary — One-time Secret Setup Checklist

```
□ Step 1: Deploy Code.gs as Web App → copy the URL
□ Step 2: Paste URL into index.html  (line ~716)
□ Step 3: Paste URL into sw.js       (line ~6)
□ Step 4: Open Apps Script → Project Settings → Script Properties
□ Step 5: Add APP_SECRET = <your random string>
□ Step 6: Push index.html + sw.js + manifest.json to GitHub Pages
□ Step 7: Test login on a real device
```

---

## 8. Setup & Deployment

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
5. Add a separate sheet tab named `List of Holidays` with holidays in column A (date format `dd-MM-yyyy`)

### Step 2 — Deploy Code.gs

1. In your Google Sheet → **Extensions → Apps Script**
2. Delete the default `myFunction()` code
3. Paste the full contents of `Code.gs`
4. Go to **⚙️ Project Settings → Script Properties** → add `APP_SECRET`
5. Click **Deploy → New Deployment**
6. Type: Web App | Execute as: Me | Who has access: Anyone
7. Copy the generated Web App URL

### Step 3 — Add the API URL to index.html & sw.js

Replace the placeholder in both files (see §7.1 above).

### Step 4 — Create your first Admin user

Go to the `Users` tab and add a row manually:

| Username | Role | Email | Password |
|---|---|---|---|
| `admin` | `Admin` | `your@email.com` | `your_password_plaintext` |

On first login the app will automatically upgrade the plaintext password to SHA-256. After that, plain text is never stored again.

### Step 5 — Host the PWA files

Upload `index.html`, `manifest.json`, and `sw.js` to any static host:

- **GitHub Pages** (free) — push to a repo, enable Pages in Settings → this is the recommended option
- **Google Sites** — embed via raw HTML widget
- **Any web server** — copy the three files to the document root

### Step 6 — Add shifts and employees

1. Log in as Admin
2. Go to **Inventory → Employees → + Add New**
3. Add shift definitions directly in the `Shifts` tab of your Google Sheet
4. Set each employee's **PIN** in the Admin Employee modal (column P)
5. Enroll faces from the **Employees** tab

---

## 9. Deployment Checklist

Run this checklist on every update:

- [ ] Bumped `CACHE_DATE` in `sw.js` (e.g. `20260422` forces all clients to download the new build)
- [ ] Re-deployed Google Apps Script as **New Deployment → Anyone**
- [ ] Updated `GOOGLE_API_URL` in **both** `index.html` and `sw.js`
- [ ] Pushed updated files to the hosting location
- [ ] Verified `APP_SECRET` is set in Script Properties (not the default fallback)
- [ ] Confirmed `ARRAYFORMULA` exists in `Data` sheet cells J1 and K1
- [ ] Set PIN values (column P) for employees who need kiosk PIN fallback
- [ ] Tested Punch IN and Punch OUT on a real device before announcing to staff

---

## 10. Offline & Sync Behaviour

Because factories frequently suffer from internet drops, the system is designed to be indestructible offline.

1. Device goes offline.
2. `submitAttendance()` writes the punch to **IndexedDB**.
3. A `sync-punches` tag is registered with the OS via `SyncManager`.
4. Even if the user minimizes the browser, when the OS regains Wi-Fi, it wakes up `sw.js`.
5. `sw.js` reads IndexedDB and POSTs the payload to `Code.gs`.
6. `Code.gs` checks fingerprints (`emplId|date|time|action`). It drops duplicates and commits the fresh punches.

**Background Sync (Chrome / Android only):**  
The Service Worker registers a `sync` event listener. The browser fires this even when the app tab is closed, providing a second layer of sync assurance on supported platforms.

**iOS Safari Fallback:**  
iOS does not support the Background Sync API. The `window.addEventListener('online', ...)` handler in `index.html` covers this — punches sync as soon as the user opens the app and connectivity is detected.

---

## 11. AI Face Recognition

### Model
`face-api.js v0.22.2` — runs entirely in the browser using WebGL acceleration. No API key. No cloud calls. No usage quota.

Three sub-models are loaded:

| Model | Purpose |
|---|---|
| `tinyFaceDetector` | Detect face bounding box (fast, low-resource) |
| `faceLandmark68Net` | Locate 68 facial landmarks |
| `faceRecognitionNet` | Generate 128-dimension face descriptor |

### Matching
- `FaceMatcher` threshold: **0.55** (lower = stricter; range 0–1)
- Descriptors stored as JSON arrays in column Q of `List_of_Empl`

### Liveness — Blink Detection
After a face is matched above threshold, the system does **not punch immediately**. It requires the employee to blink (Eye Aspect Ratio drops below 0.25, then recovers above 0.25). This prevents anyone holding up a photo to punch in on behalf of a colleague.

### PIN Fallback Flow
1. Kiosk scans for 3 consecutive failed recognition attempts (face present but no match).
2. Kiosk automatically switches to PIN pad UI.
3. Employee taps their 4-digit PIN.
4. `Code.gs` verifies the PIN against column P of `List_of_Empl`.
5. Punch is logged with `remarks: 'PIN Fallback'` for HR visibility.

### Enrollment flow
1. Camera opens
2. `detectSingleFace()` runs every 300ms
3. Camera captures 5 distinct 128-float descriptors
4. Descriptor is JSON-stringified and POSTed to `saveFaceData`
5. Sheet is updated; `buildFaceMatcher()` rebuilds the in-memory matcher

---

## 12. Payroll Engine Logic

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

## 13. Security Model

| Layer | Mechanism |
|---|---|
| Authentication | Passwords upgraded to SHA-256 hashes on first login. Plaintext never stored again. |
| Session Tokens | `Code.gs` issues a 6-hour expiring token stored in `CacheService`. All destructive API calls require a validated token. The token signing key (`APP_SECRET`) lives only in Script Properties — never in the frontend. |
| Concurrency | `LockService.waitLock(15000)` in `doPost` — prevents race conditions on simultaneous punches. |
| Role enforcement | Backend validates `callerRole` before `deleteEmpl` and `deleteUser` actions. |
| Audit trail | All admin edits, deletions, and employee correction requests written to `Audit_Log` with timestamp + username. |
| Password visibility | `getAdminUsersData()` returns `***` for all password fields — hashes never reach the browser. |
| PIN security | PINs are stored in plaintext in column P. They are a **convenience fallback only**, not a primary authentication layer. For high-security environments, treat the PIN column as sensitive data and restrict sheet access accordingly. |

---

## 14. Bug Fixes Applied — v7

### Fix 1 — `downloadCSV()` Silent Crash on API Failure
**Problem:** If the `exportCSV` API call failed (network drop, session expired, etc.), the function received an error object `{ status: 'error', message: '...' }` and blindly passed it to `atob()`. This threw a `DOMException: Failed to execute 'atob'` with zero user feedback — the button appeared to do nothing.

**Root cause:**
```javascript
// BEFORE — no guard, crashes on error object
const byteCharacters = atob(res);
```

**Fix:**
```javascript
// AFTER — check response type, show error toast if API failed
if (!res || typeof res !== 'string') {
    showToast(res?.message || 'Export failed. Try again.', 'error');
    return;
}
const byteCharacters = atob(res);
```

---

### Fix 2 — Zombie Global Variables (`consecutiveMatchId`, `consecutiveMatchCount`)
**Problem:** Two global variables declared at the top of the script were never used anywhere in the application after the kiosk was upgraded to blink-detection. The actual kiosk state (`identifiedUser`, `blinkState`) lives as closure variables inside `startKioskMode()`. The zombie globals were being uselessly reset in `stopKioskMode()` on every kiosk close, adding confusion without any function.

**Fix:** Removed both declarations and the corresponding reset lines in `stopKioskMode()`.

---

### Fix 3 — `fetchDataAndInitializeAI` / `refreshEmployeeList` Duplication
**Problem:** Both functions performed the identical operation: call `getInitData`, assign `employeeList` + `shiftsData`, call `populateDropdowns()`, resolve `myEmplId` for Employee role, and rebuild the face matcher if models were loaded. Any future bug fix to this logic had to be applied twice. They could drift out of sync.

**Fix:** Merged into a single canonical function `_loadInitData(showRefreshToast = false)`. Both `fetchDataAndInitializeAI` and `refreshEmployeeList` now call this internal function. The `showRefreshToast` parameter controls whether "Data refreshed" toast appears (only on manual hard refresh, not on initial load).

---

### Fix 4 — `hardRefreshApp` Does Not Reload Non-Dashboard Admin Sub-Tabs
**Problem:** The refresh button in the top bar called `loadDashboard()` only when the active sub-tab was `sub-btn-dash`. If the user was looking at the Employee list, User list, Leave section, or Employee Dashboard and pressed refresh, the data silently did not reload even though the button animation played.

**Fix:** Extended the refresh handler to detect the active admin sub-tab and call the appropriate loader:
```javascript
const subTabId = document.querySelector('.sub-tab.active')?.id;
if (subTabId === 'sub-btn-dash')    loadDashboard();
else if (subTabId === 'sub-btn-empl')    loadAdminEmplData();
else if (subTabId === 'sub-btn-user')    loadAdminUsersData();
// empdash and leave require manual re-query by user (no auto-reload)
```

---

### Fix 5 — Leave Confirmation Dialog Missing Balance
**Problem:** When HR/Admin clicked "Mark Leave", the confirmation dialog said *"This deducts 1 day from leave balance"* but did not show the current balance. HR could unknowingly push an employee to a negative balance.

**Fix:** The confirmation now reads:
> ⚠️ Mark Leave for Prasanna Kumar?  
> Current Leave Balance: **4 days**  
> This will deduct 1 day (new balance: **3 days**).  
> This cannot be undone without Admin edit.

---

## 15. Upgrades Applied — v7

### Upgrade 1 — PIN Fallback on Kiosk
After 3 consecutive failed face recognition attempts, the kiosk UI automatically transitions from the camera view to a numeric PIN pad. The employee taps their 4-digit PIN. `Code.gs` validates it server-side against column P of `List_of_Empl`. The punch is logged with `remarks: 'PIN Fallback'` so HR has full visibility. If an employee has no PIN set (column P is blank), the PIN pad shows a message directing them to HR.

**Column P setup:** In the Admin panel → Employees → tap Edit on any employee → enter a 4-digit number in the PIN field → Save.

---

### Upgrade 2 — Kiosk Countdown Timer Visible
The `#timer-display` element existed in the HTML but was permanently hidden (`display:none`). The inactivity timer ran invisibly. The kiosk operator had no indication of how long until the camera auto-closed.

**Fix:** The element is now shown while the kiosk camera is active and displays a live countdown: `⏱ Auto-close in 42s`. It hides again when `stopKioskMode()` is called.

---

### Upgrade 3 — Enrollment Button Label ("Re-enroll" vs "Enroll")
Previously, both enrolled and unenrolled employees showed the same `📸 Enroll Face` button. This confused staff — they could not tell if an employee was already set up without reading the small ✅/❌ badge.

**Fix:** The button now reads `🔄 Re-enroll Face` for enrolled employees and `📸 Enroll Face` for unenrolled. The enrolled badge is also shown with a slightly larger font weight to be more prominent.

---

### Upgrade 4 — Dashboard Auto-Refresh (30-second Polling)
The dashboard previously loaded once when the admin navigated to the Inventory tab. In a busy factory, the numbers became stale immediately.

**Fix:** A 30-second `setInterval` runs while `view-admin` is the active view and the active sub-tab is `dash`. The interval clears automatically when the user navigates away. A small `Last updated: just now` / `Last updated: 1 min ago` counter below the stats grid shows data freshness at a glance.

---

### Upgrade 5 — "Export Current View" in History
The original export only accepted a month input and exported the full month for all employees. Users wanted to export the exact filtered result they were already looking at on screen.

**Fix:** An **"Export This View ↓"** button added below the history results table. It converts `historyData` (the current in-memory search result) directly to CSV via a Blob URL — no extra API call, instant download.

---

### Upgrade 6 — Employee Correction Requests
Employees could see their attendance history but had no way to flag errors to HR. They had to call or message HR separately, and HR had no record of the request.

**Fix:** Employee-role users see a small `⚑ Flag` button on each row of their own history table. Clicking it opens a small modal: *"Describe the issue"* + Submit. On submit, `Code.gs` appends a row to `Audit_Log` with the tag `CORRECTION_REQUEST` along with the row index, employee ID, and the description. Admin/HR see these flagged entries when they open `Audit_Log` in the sheet, or via a future "Pending Corrections" UI.

---

### Upgrade 7 — Toast Notification Queue
Multiple rapid actions (e.g., save employee → the app reloads data → sync completes) caused 2–3 toasts to fire simultaneously, stacking on top of each other and becoming unreadable.

**Fix:** A toast queue system (max 3 items) processes messages sequentially:
- New toast → pushed to queue
- If no toast is visible → dequeued and shown immediately
- After display duration (3s) + fade-out → next item dequeued
- Overflow beyond 3 pending → oldest pending is silently dropped

---

## 16. Known Limitations

| # | Limitation | Workaround |
|---|---|---|
| 1 | Google Apps Script has a **6-minute execution limit** — large `exportCSV` calls on very long history may time out | Export by month, not full history |
| 2 | `face-api.js` accuracy drops in poor lighting or with glasses/masks | Use good lighting at the kiosk; re-enroll with glasses if needed |
| 3 | iOS Safari does not support the **Background Sync API** | The `online` event listener covers iOS; punch syncs when the user opens the app |
| 4 | Google Sheets has a **10 million cell limit** | Archive old months to a separate sheet annually |
| 5 | ArrayFormula ghost rows | `ARRAYFORMULA` in J1/K1 creates phantom rows. All backend functions use `getTrueLastRow()` to bypass them — do not delete this helper |
| 6 | PIN fallback is plaintext in the sheet | PINs are a convenience fallback, not a primary security mechanism. Restrict sheet-level access in Google Drive to HR/Admin Google accounts |
| 7 | Correction requests are Audit_Log entries only | There is no in-app "pending corrections inbox" yet. HR must check the sheet's `Audit_Log` tab for `CORRECTION_REQUEST` rows |
| 8 | `APP_SECRET` fallback | If `APP_SECRET` is not set in Script Properties, the backend uses a hardcoded default. Always set a custom value in production |

---

## 17. Upgrade History

### v7 — Current
- **PIN Fallback Kiosk:** 3 failed face scans → auto-switch to numeric PIN pad (column P)
- **Kiosk Countdown Visible:** Live seconds displayed on kiosk camera view
- **Enrollment Button Labels:** "Re-enroll" vs "Enroll" based on existing face data
- **Dashboard Auto-Refresh:** 30-second polling + last-refreshed label
- **Export Current View:** Instant CSV of filtered history results without extra API call
- **Employee Correction Requests:** Flag attendance rows; logged to Audit_Log
- **Toast Queue:** Up to 3 queued notifications shown sequentially, no overlapping
- **Bug Fix — CSV Export Crash:** Guard added before `atob()` call
- **Bug Fix — Zombie Globals:** `consecutiveMatchId` / `consecutiveMatchCount` removed
- **Bug Fix — Data Load Duplication:** `fetchDataAndInitializeAI` and `refreshEmployeeList` merged into `_loadInitData()`
- **Bug Fix — hardRefreshApp Sub-Tabs:** Refresh now reloads Employee and User lists too
- **Bug Fix — Leave Balance in Dialog:** Current balance shown before deduction confirmation
- **Security — APP_SECRET Guide:** Full documentation on Script Properties setup (§7)

### v6 — Enterprise Refactor
- IndexedDB Sync, Session Tokens, Ghost Sunday Fix, Blob CSV Export, Cache Chunking, CSS Transform Zoom, ArrayFormulas, Safe CSVs, Manifest Intents, Blink-detection liveness

### v4 / v5 — Legacy
- Script lock concurrency, PDF payslip, basic offline queuing, SHA-256

---

## 18. Troubleshooting

**"API Permission Error. Re-deploy Google Script as 'Anyone'"**  
→ Go to Apps Script → Deploy → Manage Deployments → edit → change "Who has access" to **Anyone**.

---

**"Session expired — please log in again" on every reload**  
→ The `APP_SECRET` in Script Properties may have changed (or been deleted) between sessions. Session tokens from the old secret are now invalid. Re-set `APP_SECRET` to a fixed value in Project Settings and avoid changing it unless rotating credentials intentionally.

---

**Face not recognized at the kiosk / PIN pad appears immediately**  
→ Check: (1) Employee is enrolled — their card shows ✅ Enrolled. (2) Lighting is adequate. (3) Lower the `FaceMatcher` threshold in `buildFaceMatcher()` (default 0.55 — try 0.6 to be less strict). (4) Re-enroll the employee in the actual kiosk lighting conditions.

---

**PIN fallback not working (shows "No PIN set")**  
→ Admin → Inventory → Employees → Edit the employee → Enter a 4-digit PIN → Save. Verify column P in `List_of_Empl` shows the PIN.

---

**Offline punches not syncing**  
→ Check `IndexedDB` in DevTools → Application → IndexedDB → `CapcoOfflineDB`. If it has data, reload while online. If empty, the punch was never saved — check if the device was truly offline or if the API returned an error.

---

**Payslip shows ₹0 net pay**  
→ Check: (1) Salary fields in `List_of_Empl` are populated. (2) The selected month has attendance records. (3) The `H/S` tab has an entry for that month.

---

**Service Worker not updating after deploy**  
→ DevTools → Application → Service Workers → click **Update** or **Skip Waiting**. Always bump `CACHE_DATE` in `sw.js` before pushing.

---

**"Employee not found in Database" on payslip**  
→ The Employee role username must match the Employee ID in `List_of_Empl` column A exactly. Check for leading/trailing spaces.

---

**Dashboard numbers not refreshing**  
→ The 30-second auto-refresh only runs while the Dashboard sub-tab is active. If you're on a different sub-tab, navigate back to Dashboard. Manual refresh icon in the top bar forces an immediate reload regardless of sub-tab.

---

**CSV export downloads empty file**  
→ No data for the selected month, or the Google Script timed out (> 6 minutes of data). Try a narrower month range. Check the browser console for error details.

---

*Built for Capco Capacitor, Muppireddypally, Telangana. v7 — April 2026.*
