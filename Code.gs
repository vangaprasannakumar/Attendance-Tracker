const DATA_SHEET  = 'Data';
const USERS_SHEET = 'Users';
const EMPL_SHEET  = 'List_of_Empl';
const SHIFT_SHEET = 'Shifts';
const AUDIT_SHEET = 'Audit_Log';
const HS_SHEET    = 'H/S';
const OT_SHEET    = 'OT_Empl';

function doGet() { return ContentService.createTextOutput("Capco Master API is Online."); }

// --- SECURITY HELPERS ---
function sha256(str) {
  const signature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str);
  return signature.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);

    const data   = JSON.parse(e.postData.contents);
    const action = data.action;
    let result   = {};

    if      (action === 'login')             result = verifyLogin(data.username, data.password);
    else if (action === 'getInitData')       result = { employees: getEmployees(), shifts: getShifts() };
    else if (action === 'logAttendance')     result = logAttendance(data.emplId, data.emplName, data.type, data.remarks, data.loggedByUser, data.offlineTimeIso, data.selectedShift);
    else if (action === 'saveFaceData')      result = saveFaceData(data.emplId, data.faceDataStr);
    else if (action === 'getEmployeeStatus') result = getEmployeeStatus(data.emplId);
    else if (action === 'getDashboardStats') result = getDashboardStats();
    else if (action === 'searchHistory')     result = searchHistory(data.month, data.date, data.query);
    else if (action === 'getEmpDashData')    result = getEmpDashData(data.emplId, data.month);
    else if (action === 'adminUpdateRecord') result = adminUpdateRecord(data.row, data.inTime, data.outTime, data.perm, data.remarks, data.user);
    else if (action === 'exportCSV')         result = exportCSV(data.month);
    else if (action === 'markLeaveAdmin')    result = markLeaveAdmin(data.emplId, data.date, data.remarks, data.user);
    else if (action === 'getAdminUsersData') result = getAdminUsersData();
    else if (action === 'saveUser')          result = saveUser(data.row, data.username, data.role, data.email, data.pass);

    // [FIX-C4] deleteUser now requires role verification — only Admin can delete users
    else if (action === 'deleteUser')        result = deleteUser(data.row, data.user, data.role);

    else if (action === 'getAdminEmplData')  result = getAdminEmplData();
    else if (action === 'saveEmpl')          result = saveEmpl(data);

    // [FIX-C4] deleteEmpl now requires role verification — only Admin or HR can delete employees
    else if (action === 'deleteEmpl')        result = deleteEmpl(data.row, data.user, data.role);

    else if (action === 'bulkAddEmployees')  result = bulkAddEmployees(data.csv);

    // [FIX-C3] syncOfflineData now deduplicates by emplId+timestamp before writing
    else if (action === 'syncOfflineData')   result = syncOfflineData(data.pending);

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// ─── UTILITY HELPERS ────────────────────────────────────────────────────────

function cleanNum(val)        { return Number(String(val).replace(/[^0-9.-]+/g, "")) || 0; }
function formatTime(dateObj)  { return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "HH:mm"); }
function formatTimeRaw(val)   { return val instanceof Date ? Utilities.formatDate(val, Session.getScriptTimeZone(), "HH:mm") : val.toString(); }

// ─── SHIFTS & EMPLOYEES ─────────────────────────────────────────────────────

function getShifts() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHIFT_SHEET);
  if (!sheet) return [];
  const data = sheet.getDataRange().getDisplayValues();
  let shifts = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) shifts.push({ name: data[i][0], start: data[i][1], end: data[i][2] });
  }
  return shifts;
}

function getEmployees() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET);
  const data  = sheet.getDataRange().getDisplayValues();
  let employees = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) employees.push({
      rowIndex: i + 1, id: data[i][0], name: data[i][1],
      shift: data[i][2] || 'REGULAR', category: data[i][3] || 'Staff Without OT',
      leaveBal: cleanNum(data[i][4]),  gross: cleanNum(data[i][5]),
      basic:    cleanNum(data[i][6]),  hra:   cleanNum(data[i][7]),
      conv:     cleanNum(data[i][8]),  spl:   cleanNum(data[i][9]),
      med:      cleanNum(data[i][10]), esi:   cleanNum(data[i][11]),
      pf:       cleanNum(data[i][12]), vpf:   cleanNum(data[i][13]),
      pt:       cleanNum(data[i][14]), pin:   data[i][15] || '',
      faceData: data[i][16] || ''
    });
  }
  return employees;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

function verifyLogin(username, password) {
  const sheet       = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
  const data        = sheet.getDataRange().getDisplayValues();
  const hashedInput = sha256(password);

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
      if (data[i][3] === password || data[i][3] === hashedInput) {
        // Auto-upgrade plain-text passwords to SHA-256 on first login
        if (data[i][3] === password) sheet.getRange(i + 1, 4).setValue(hashedInput);
        return { status: 'success', username: data[i][0], role: data[i][1], email: data[i][2] };
      }
    }
  }
  return { status: 'error', message: 'Invalid Username or Password' };
}

// ─── FACE DATA ───────────────────────────────────────────────────────────────

function saveFaceData(emplId, faceDataStr) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET);
    const data  = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === emplId.toString()) {
        sheet.getRange(i + 1, 17).setValue(faceDataStr);
        return { status: 'success' };
      }
    }
    return { status: 'error', message: 'Employee ID not found' };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// ─── EMPLOYEE STATUS ─────────────────────────────────────────────────────────

function getEmployeeStatus(emplId) {
  const sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
  const data     = sheet.getDataRange().getDisplayValues();
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  for (let i = data.length - 1; i > 0; i--) {
    if (data[i][0] === todayStr && data[i][2].toString() === emplId.toString()) {
      const inT   = data[i][6];
      const outT  = data[i][8];
      const leave = inT === 'LEAVE';
      if (leave)        return { status: 'LEAVE', msg: '🔴 On Leave Today' };
      if (inT && outT)  return { status: 'OUT',   msg: `⚪ Punched Out at ${outT}` };
      if (inT && !outT) return { status: 'IN',    msg: `🟢 Punched In at ${inT}` };
    }
  }
  return { status: 'NONE', msg: '⭕ Not Punched Today' };
}

// ─── LEAVE BALANCE ───────────────────────────────────────────────────────────

function updateLeaveBalance(emplId, amount) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === emplId.toString()) {
      let currentBal = parseFloat(data[i][4]) || 0;
      sheet.getRange(i + 1, 5).setValue(currentBal + amount);
      break;
    }
  }
}

// ─── TIME HELPERS ────────────────────────────────────────────────────────────

function getMinutesDiff(startStr, endStr) {
  if (!startStr || !endStr || startStr === 'LEAVE' || endStr === 'LEAVE') return 0;
  let s = startStr.split(':'); let e = endStr.split(':');
  let sMins = parseInt(s[0]) * 60 + parseInt(s[1]);
  let eMins = parseInt(e[0]) * 60 + parseInt(e[1]);
  if (eMins < sMins) eMins += 24 * 60;
  return eMins - sMins;
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  let parts = timeStr.toString().split(':');
  if (parts.length < 2) return 0;
  return (parseInt(parts[0]) * 60) + parseInt(parts[1]);
}

// ─── LOG ATTENDANCE ──────────────────────────────────────────────────────────

function logAttendance(emplId, emplName, actionType, remarks, loggedByUser, offlineTimeIso, selectedShift) {
  try {
    const sheet     = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
    const punchDate = offlineTimeIso ? new Date(offlineTimeIso) : new Date();
    const dateStr   = Utilities.formatDate(punchDate, Session.getScriptTimeZone(), "dd-MM-yyyy");
    const dayStr    = Utilities.formatDate(punchDate, Session.getScriptTimeZone(), "EEEE");
    const timeStr   = Utilities.formatDate(punchDate, Session.getScriptTimeZone(), "HH:mm");

    const data   = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      let sheetDate = data[i][0] instanceof Date
        ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "dd-MM-yyyy")
        : String(data[i][0]);
      if (sheetDate === dateStr && data[i][2].toString() === emplId.toString()) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      if (actionType === 'out') return { status: 'error', message: `❌ Error: Cannot Punch OUT without IN time!` };
      if (!emplName) {
        const eList = getEmployees();
        const f = eList.find(e => e.id.toString() === emplId.toString());
        if (f) emplName = f.name;
      }
      const lastRow = sheet.getLastRow();
      sheet.appendRow([dateStr, dayStr, emplId, emplName, selectedShift, '', '', '', '', '', '', '', remarks, loggedByUser, '']);
      rowIndex = lastRow + 1;
      copyFormulasToNewRow(sheet, lastRow, rowIndex);
    }

    let existingIn  = sheet.getRange(rowIndex, 7).getDisplayValue();
    let existingOut = sheet.getRange(rowIndex, 9).getDisplayValue();
    let isNewLeave  = false;

    if (actionType === 'in') {
      if (existingIn && existingIn !== '') {
        if (existingOut && existingOut !== '') return { status: 'error', message: `❌ Already IN at ${existingIn} & OUT at ${existingOut}. Cannot edit.` };
        return { status: 'error', message: `❌ Already Punched IN at ${existingIn}.` };
      }
      sheet.getRange(rowIndex, 7).setValue(timeStr);
    }
    else if (actionType === 'out') {
      if (!existingIn || existingIn === '')  return { status: 'error', message: `❌ Error: Cannot Punch OUT without IN time!` };
      if (existingOut && existingOut !== '') return { status: 'error', message: `❌ Already Punched OUT at ${existingOut}.` };
      sheet.getRange(rowIndex, 9).setValue(timeStr);
      const empInfo = getEmployees().find(e => e.id.toString() === emplId.toString());
      if (empInfo && empInfo.category === 'Staff With SOT') {
        const elapsedMins = getMinutesDiff(existingIn, timeStr);
        let flags = sheet.getRange(rowIndex, 15).getValue() || '';
        if (elapsedMins >= 720 && !flags.includes('SOT_BONUS_ADDED')) {
          updateLeaveBalance(emplId, 0.5);
          sheet.getRange(rowIndex, 15).setValue(flags + ' SOT_BONUS_ADDED');
        }
      }
    }
    else if (actionType === 'permission') {
      sheet.getRange(rowIndex, 12).setValue(timeStr);
    }
    else if (actionType === 'leave') {
      if (existingIn !== 'LEAVE') isNewLeave = true;
      sheet.getRange(rowIndex, 7).setValue('LEAVE');
      sheet.getRange(rowIndex, 9).setValue('LEAVE');
    }

    if (remarks !== '') {
      let currentRemarks = sheet.getRange(rowIndex, 13).getValue();
      sheet.getRange(rowIndex, 13).setValue(currentRemarks ? currentRemarks + " | " + remarks : remarks);
    }
    if (isNewLeave) updateLeaveBalance(emplId, -1);

    applyFormulas(sheet, rowIndex);
    return {
      status: 'success',
      message: `✅ ${emplName || 'Employee'} Punched ${actionType.toUpperCase()} at ${timeStr}`,
      newStatus: getEmployeeStatus(emplId)
    };
  } catch (error) { return { status: 'error', message: error.toString() }; }
}

// ─── FORMULA HELPERS ─────────────────────────────────────────────────────────

function copyFormulasToNewRow(sheet, previousRowIndex, newRowIndex) {
  if (previousRowIndex <= 1) return;
  for (let col = 1; col <= sheet.getLastColumn(); col++) {
    let formula = sheet.getRange(previousRowIndex, col).getFormulaR1C1();
    if (formula) sheet.getRange(newRowIndex, col).setFormulaR1C1(formula);
  }
}

function applyFormulas(sheet, rowIndex) {
  const jFormula = `=IF(AND(G${rowIndex}<>"", I${rowIndex}<>"", G${rowIndex}<>"LEAVE"), MOD(I${rowIndex}-G${rowIndex}, 1) - IF(AND(G${rowIndex}<=TIME(13,30,0), I${rowIndex}>=TIME(14,0,0)), TIME(0,30,0), 0), "")`;
  const kFormula = `=IF(OR(G${rowIndex}="", I${rowIndex}="", G${rowIndex}="LEAVE"), "", LET(tMins, MOD(I${rowIndex}-G${rowIndex},1)*1440, bMins, IF(OR(B${rowIndex}="Sunday", COUNTIF('List of Holidays'!$A:$A, A${rowIndex})>0), 30, IF(tMins>=720, 480, 510)), otMins, tMins - bMins, IF(otMins>0, IF(INT((otMins+5)/30)*30 > 0, INT((otMins+5)/30)*30/1440, ""), "")))`;
  sheet.getRange(rowIndex, 10).setFormula(jFormula).setNumberFormat("[h]:mm");
  sheet.getRange(rowIndex, 11).setFormula(kFormula).setNumberFormat("[h]:mm");
}

// ─── ADMIN: LEAVE ─────────────────────────────────────────────────────────────

function markLeaveAdmin(emplId, dateStrInput, remarks, adminName) {
  try {
    const sheet    = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
    const parts    = dateStrInput.split('-');
    const dateStr  = `${parts[2]}-${parts[1]}-${parts[0]}`;
    const data     = sheet.getDataRange().getValues();
    const emplList = getEmployees();
    const empInfo  = emplList.find(e => e.id.toString() === emplId.toString());
    if (!empInfo) return { status: 'error', message: 'Employee not found.' };

    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      let sheetDate = data[i][0] instanceof Date
        ? Utilities.formatDate(data[i][0], Session.getScriptTimeZone(), "dd-MM-yyyy")
        : data[i][0];
      if (sheetDate === dateStr && data[i][2].toString() === emplId.toString()) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      rowIndex = sheet.getLastRow() + 1;
      let dObj      = new Date(parts[0], parts[1] - 1, parts[2]);
      let dayStr    = Utilities.formatDate(dObj, Session.getScriptTimeZone(), "EEEE");
      const shifts  = getShifts();
      const shiftInfo = shifts.find(s => s.name === empInfo.shift) || { name: 'REGULAR', start: '09:00', end: '17:30' };
      sheet.appendRow([dateStr, dayStr, emplId, empInfo.name, shiftInfo.name, formatTimeRaw(shiftInfo.start), 'LEAVE', formatTimeRaw(shiftInfo.end), 'LEAVE', '', '', '', remarks, adminName, '']);
      updateLeaveBalance(emplId, -1);
    } else {
      const currentIn = sheet.getRange(rowIndex, 7).getValue();
      sheet.getRange(rowIndex, 7).setValue('LEAVE');
      sheet.getRange(rowIndex, 9).setValue('LEAVE');
      if (remarks) {
        let currentRemarks = sheet.getRange(rowIndex, 13).getValue();
        sheet.getRange(rowIndex, 13).setValue(currentRemarks ? currentRemarks + " | " + remarks : remarks);
      }
      if (currentIn !== 'LEAVE') updateLeaveBalance(emplId, -1);
    }

    SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(AUDIT_SHEET)
      .appendRow([new Date(), adminName, emplId, empInfo.name, 'N/A', `Assigned LEAVE for ${dateStr}. Rem: ${remarks}`]);

    applyFormulas(sheet, rowIndex);
    return { status: 'success' };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// ─── ADMIN: EMPLOYEES ─────────────────────────────────────────────────────────

function getAdminEmplData() {
  const data = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET).getDataRange().getDisplayValues();
  let empls  = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) empls.push({
      rowIndex: i + 1, id: data[i][0], name: data[i][1], shift: data[i][2], category: data[i][3],
      leaveBal: cleanNum(data[i][4]),  gross: cleanNum(data[i][5]),
      basic:    cleanNum(data[i][6]),  hra:   cleanNum(data[i][7]),
      conv:     cleanNum(data[i][8]),  spl:   cleanNum(data[i][9]),
      med:      cleanNum(data[i][10]), esi:   cleanNum(data[i][11]),
      pf:       cleanNum(data[i][12]), vpf:   cleanNum(data[i][13]),
      pt:       cleanNum(data[i][14]), pin:   data[i][15] || '',
      faceData: data[i][16] || ''
    });
  }
  return empls;
}

function saveEmpl(d) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET);
    let rIdx    = parseInt(d.row, 10);
    let faceDataStr = '';
    if (!isNaN(rIdx) && rIdx > 0) faceDataStr = sheet.getRange(rIdx, 17).getValue();

    let rowData = [
      d.id || '', d.name || '', d.shift || 'REGULAR', d.category || 'Staff Without OT',
      cleanNum(d.leavebal), cleanNum(d.gross), cleanNum(d.basic), cleanNum(d.hra),
      cleanNum(d.conv),     cleanNum(d.spl),   cleanNum(d.med),   cleanNum(d.esi),
      cleanNum(d.pf),       cleanNum(d.vpf),   cleanNum(d.pt),    d.pin || '',
      faceDataStr
    ];

    if (!isNaN(rIdx) && rIdx > 0) {
      sheet.getRange(rIdx, 1, 1, 17).setValues([rowData]);
    } else {
      const data = sheet.getDataRange().getDisplayValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === d.id.toString()) return { status: 'error', message: 'Employee ID already exists!' };
      }
      sheet.appendRow(rowData);
    }
    return { status: 'success' };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// [FIX-C4] deleteEmpl — only Admin or HR roles are permitted to delete employees
function deleteEmpl(rowStr, callerUser, callerRole) {
  if (callerRole !== 'Admin' && callerRole !== 'HR') {
    return { status: 'error', message: 'Permission denied. Only Admin or HR can delete employees.' };
  }
  let rIdx = parseInt(rowStr, 10);
  if (!isNaN(rIdx) && rIdx > 0) {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET).deleteRow(rIdx);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET)
      .appendRow([new Date(), callerUser, 'N/A', 'N/A', `Deleted employee at row ${rIdx}`, '']);
  }
  return { status: 'success' };
}

// ─── ADMIN: USERS ─────────────────────────────────────────────────────────────

function getAdminUsersData() {
  const data = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET).getDataRange().getDisplayValues();
  let users  = [];
  for (let i = 1; i < data.length; i++) {
    // Passwords are never returned to the frontend
    if (data[i][0]) users.push({ rowIndex: i + 1, username: data[i][0], role: data[i][1], email: data[i][2], pass: '***' });
  }
  return users;
}

function saveUser(rowStr, u, r, e, p) {
  try {
    const sheet      = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET);
    let rIdx         = parseInt(rowStr, 10);
    const hashedPass = p ? sha256(p) : '';

    if (!isNaN(rIdx) && rIdx > 0) {
      if (p) {
        sheet.getRange(rIdx, 1, 1, 4).setValues([[u, r, e, hashedPass]]);
      } else {
        sheet.getRange(rIdx, 1, 1, 3).setValues([[u, r, e]]); // keep existing password hash
      }
    } else {
      const data = sheet.getDataRange().getDisplayValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString().toLowerCase() === u.toLowerCase()) return { status: 'error', message: 'Username already exists!' };
      }
      sheet.appendRow([u, r, e, hashedPass]);
    }
    return { status: 'success' };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// [FIX-C4] deleteUser — only Admin role is permitted to delete app users
function deleteUser(rowStr, callerUser, callerRole) {
  if (callerRole !== 'Admin') {
    return { status: 'error', message: 'Permission denied. Only Admin can delete users.' };
  }
  let rIdx = parseInt(rowStr, 10);
  if (!isNaN(rIdx) && rIdx > 0) {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_SHEET).deleteRow(rIdx);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET)
      .appendRow([new Date(), callerUser, 'N/A', 'N/A', `Deleted user at row ${rIdx}`, '']);
  }
  return { status: 'success' };
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function getDashboardStats() {
  const sheet     = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
  const emplSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET);
  const data      = sheet.getDataRange().getDisplayValues();
  const totalEmpl = Math.max(0, emplSheet.getLastRow() - 1);
  const todayStr  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");

  let currentlyIn = 0, currentlyOut = 0, onLeave = 0, lateArrivals = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === todayStr) {
      let inTime     = data[i][6];
      let outTime    = data[i][8];
      let shiftStart = data[i][5];
      if (inTime === 'LEAVE')                      onLeave++;
      else if (inTime && !outTime)                 currentlyIn++;
      else if (inTime && outTime)                  currentlyOut++;
      if (inTime && inTime !== 'LEAVE' && shiftStart) {
        if (parseTimeToMinutes(inTime) > parseTimeToMinutes(shiftStart)) lateArrivals++;
      }
    }
  }
  return { total: totalEmpl, present: currentlyIn + currentlyOut, inNow: currentlyIn, outNow: currentlyOut, leave: onLeave, late: lateArrivals };
}

// ─── EMPLOYEE PAYROLL DASHBOARD ───────────────────────────────────────────────

function getEmpDashData(emplId, monthStr) {
  try {
    if (!emplId || !monthStr) return { error: 'Missing parameters' };
    const [year, month] = monthStr.split('-');
    const monthNames    = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const mName         = monthNames[parseInt(month) - 1];
    const targetDateStr = `${month}-${year}`;

    let hsSheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HS_SHEET);
    let monthDays = new Date(year, month, 0).getDate();
    let ph        = 0; // public holidays only — Sundays tallied separately

    if (hsSheet) {
      let hsData = hsSheet.getDataRange().getValues();
      for (let i = 1; i < hsData.length; i++) {
        if (hsData[i][0] === mName) {
          monthDays = parseInt(hsData[i][1]) || monthDays;
          ph        = parseInt(hsData[i][2]) || 0;
          break;
        }
      }
    }

    let emplData = getAdminEmplData().find(e => e.id.toString() === emplId.toString());
    if (!emplData) return { error: 'Employee not found in Database.' };

    let otGross = emplData.gross;
    let otSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OT_SHEET);
    if (otSheet) {
      let otData = otSheet.getDataRange().getDisplayValues();
      for (let i = 1; i < otData.length; i++) {
        if (otData[i][0].toString() === emplId.toString()) { otGross = cleanNum(otData[i][2]); break; }
      }
    }

    let perHour = 0, perDay = 0;
    if (monthDays > 0) {
      perDay  = Math.round((otGross / monthDays) * 100) / 100;
      perHour = Math.round((perDay / 8) * 100) / 100;
    }

    // [FIX-I4] Sundays are now counted as unique calendar dates — not per attendance record.
    // Previously, ph++ ran inside the loop and would increment once per row that fell on a Sunday.
    // If multiple employees happened to punch on the same Sunday (or data was replayed),
    // the count would inflate. Now we collect unique Sunday date strings in a Set,
    // then add the Set size once — guaranteeing each Sunday is counted exactly once.
    let dataSheet      = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET).getDataRange().getDisplayValues();
    let presentCount   = 0;
    let leaveCount     = 0;
    let totalExtraMins = 0;
    let sundayDates    = new Set(); // unique Sunday dates within the target month

    for (let i = 1; i < dataSheet.length; i++) {
      let rDate = dataSheet[i][0];
      if (rDate.length >= 10 && rDate.substring(3, 10) === targetDateStr) {

        // Collect unique Sundays regardless of employee
        if (dataSheet[i][1] === 'Sunday') sundayDates.add(rDate);

        // Per-employee attendance stats
        if (dataSheet[i][2].toString() === emplId.toString()) {
          let inT = dataSheet[i][6];
          if (inT === 'LEAVE') leaveCount++;
          else if (inT)        presentCount++;

          let extT = dataSheet[i][10];
          if (extT && extT.includes(':')) {
            let parts = extT.split(':');
            totalExtraMins += parseInt(parts[0]) * 60 + parseInt(parts[1]);
          }
        }
      }
    }

    let sundayCount       = sundayDates.size; // [FIX-I4] each Sunday counted once
    let extraHoursDecimal = totalExtraMins / 60;
    let otEarnings        = extraHoursDecimal * perHour;
    let payableDays       = presentCount + ph + sundayCount;
    if (payableDays > monthDays) payableDays = monthDays;
    let factor = monthDays > 0 ? (payableDays / monthDays) : 0;

    let pGross = Math.round(emplData.gross * factor) || 0;
    let pBasic = Math.round(emplData.basic * factor) || 0;
    let pHra   = Math.round(emplData.hra   * factor) || 0;
    let pConv  = Math.round(emplData.conv  * factor) || 0;
    let pSpl   = Math.round(emplData.spl   * factor) || 0;
    let pMed   = Math.round(emplData.med   * factor) || 0;

    let pEsi = (emplData.gross <= 21000) ? Math.round(pGross * 0.0075) : 0;
    let pPf  = Math.round(pBasic * 0.12);
    let pVpf = cleanNum(emplData.vpf);
    let pPt  = 0;
    if      (emplData.gross >= 20000) pPt = 200;
    else if (emplData.gross >= 15000) pPt = 150;

    let totalDeductions = pEsi + pPf + pVpf + pPt;
    let netPay          = pGross + otEarnings - totalDeductions;

    return {
      status: 'success', emplId: emplData.id, emplName: emplData.name,
      category: emplData.category, leaveBal: emplData.leaveBal,
      month: mName, year: year, monthDays: monthDays,
      ph: ph + sundayCount,        // combined public holidays + Sundays for payslip display
      present: presentCount, leaves: leaveCount, payableDays: payableDays,
      extraHours: extraHoursDecimal.toFixed(2), perHour: perHour,
      otEarnings: otEarnings, actualGross: emplData.gross,
      gross: pGross, basic: pBasic, hra: pHra, conv: pConv, spl: pSpl, med: pMed,
      esi: pEsi, pf: pPf, vpf: pVpf, pt: pPt,
      deductions: totalDeductions, netPay: netPay
    };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// ─── HISTORY & SEARCH ────────────────────────────────────────────────────────

function searchHistory(monthStr, exactDateStr, searchQuery) {
  const sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
  const data    = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return [];
  const results    = [];
  const queryLower = searchQuery ? searchQuery.toLowerCase() : "";

  for (let i = data.length - 1; i > 0; i--) {
    const row         = data[i];
    const rowDate     = row[0];
    const rowEmplId   = row[2].toString().toLowerCase();
    const rowEmplName = row[3].toString().toLowerCase();
    let match = true;

    if (queryLower && !rowEmplId.includes(queryLower) && !rowEmplName.includes(queryLower)) match = false;
    if (exactDateStr && rowDate !== exactDateStr.split('-').reverse().join('-')) match = false;
    if (!exactDateStr && monthStr && rowDate.length >= 10) {
      if (rowDate.substring(3, 5) !== monthStr.split('-')[1] || rowDate.substring(6, 10) !== monthStr.split('-')[0]) match = false;
    }
    if (match) results.push({
      rowIndex: i + 1, date: rowDate, day: row[1], emplId: row[2], emplName: row[3],
      shift: row[4], inTime: row[6], outTime: row[8], otTime: row[10],
      permTime: row[11], remarks: row[12], loggedBy: row[13]
    });
  }
  return results;
}

function adminUpdateRecord(rowIndex, inT, outT, permT, remarks, adminName) {
  try {
    const sheet      = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
    const auditSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(AUDIT_SHEET);
    let r = parseInt(rowIndex, 10);
    if (!isNaN(r) && r > 0) {
      const oldVals = sheet.getRange(r, 1, 1, 15).getDisplayValues()[0];
      auditSheet.appendRow([new Date(), adminName, oldVals[2], oldVals[3],
        `In:${oldVals[6]}|Out:${oldVals[8]}|P:${oldVals[11]}|R:${oldVals[12]}`,
        `In:${inT}|Out:${outT}|P:${permT}|R:${remarks}`]);
      sheet.getRange(r, 7).setValue(inT);
      sheet.getRange(r, 9).setValue(outT);
      sheet.getRange(r, 12).setValue(permT);
      sheet.getRange(r, 13).setValue(remarks);
      applyFormulas(sheet, r);
    }
    return { status: 'success' };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────

function exportCSV(monthStr) {
  const data = searchHistory(monthStr, '', '');
  let csvContent = "Date,Day,Employee ID,Employee Name,Shift,In Time,Out Time,OT Hours,Permission,Remarks,Logged By\n";
  data.forEach(r => {
    csvContent += `"${r.date}","${r.day}","${r.emplId}","${r.emplName}","${r.shift}","${r.inTime}","${r.outTime}","${r.otTime}","${r.permTime}","${r.remarks}","${r.loggedBy}"\n`;
  });
  return Utilities.base64Encode(Utilities.newBlob(csvContent).getBytes());
}

// ─── BULK ADD ────────────────────────────────────────────────────────────────

function bulkAddEmployees(csvText) {
  try {
    const sheet        = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EMPL_SHEET);
    const existingData = sheet.getDataRange().getDisplayValues();
    const existingIds  = new Set(existingData.slice(1).map(r => r[0].toString().trim()));

    const rows = csvText.split('\n');
    let addedCount = 0;
    rows.forEach(row => {
      const parts = row.split(',');
      if (parts.length >= 2 && parts[0].trim() !== '') {
        const newId = parts[0].trim();
        if (existingIds.has(newId)) return; // skip duplicate IDs silently
        let s  = parts[2] ? parts[2].trim() : 'REGULAR';
        let c  = parts[3] ? parts[3].trim() : 'Staff Without OT';
        let lb = parts[4] ? parts[4].trim() : 0;
        sheet.appendRow([newId, parts[1].trim(), s, c, lb, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '']);
        existingIds.add(newId);
        addedCount++;
      }
    });
    return { status: 'success', count: addedCount, data: getAdminEmplData() };
  } catch (e) { return { status: 'error', message: e.toString() }; }
}

// ─── OFFLINE SYNC ────────────────────────────────────────────────────────────
//
// [FIX-C3] Complete rewrite with fingerprint-based deduplication.
//
// Problem: The old forEach loop had no way to detect whether a punch from the
// offline queue had already been written (e.g. if the user synced, the app
// crashed, and synced again). Replaying the same queue would create duplicate
// rows or double-write times.
//
// Fix: Before processing any pending punch, we scan the Data sheet and build a
// Set of fingerprints in the format "emplId|dd-MM-yyyy|HH:mm|action".
// Each pending punch is converted to the same fingerprint format.
// If the fingerprint is already in the Set, the punch is skipped.
// Successfully synced punches are added to the Set immediately so that
// same-batch duplicates (two identical items in one offline queue) are also caught.
//
// Returns: { status, synced, skipped } so the frontend can show a meaningful result.
//
function syncOfflineData(pending) {
  if (!pending || pending.length === 0) return { status: 'success', synced: 0, skipped: 0 };

  const sheet     = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_SHEET);
  const sheetData = sheet.getDataRange().getDisplayValues();
  const tz        = Session.getScriptTimeZone();

  // Build existing fingerprints from the sheet
  const existingFingerprints = new Set();
  for (let i = 1; i < sheetData.length; i++) {
    let dateStr = sheetData[i][0];
    let emplId  = sheetData[i][2].toString();
    let inTime  = sheetData[i][6];
    let outTime = sheetData[i][8];
    if (inTime  && inTime  !== '') existingFingerprints.add(`${emplId}|${dateStr}|${inTime}|in`);
    if (outTime && outTime !== '') existingFingerprints.add(`${emplId}|${dateStr}|${outTime}|out`);
  }

  let synced = 0, skipped = 0;
  pending.forEach(p => {
    try {
      const punchDate = new Date(p.timestamp);
      const dateStr   = Utilities.formatDate(punchDate, tz, "dd-MM-yyyy");
      const timeStr   = Utilities.formatDate(punchDate, tz, "HH:mm");
      const fp        = `${p.emplId}|${dateStr}|${timeStr}|${p.action}`;

      if (existingFingerprints.has(fp)) {
        skipped++;
        return; // already recorded — skip without error
      }

      const result = logAttendance(
        p.emplId, p.emplName, p.action,
        p.remarks, p.loggedByUser,
        p.timestamp, p.shift
      );

      if (result.status === 'success') {
        existingFingerprints.add(fp); // prevent same-batch duplicate
        synced++;
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
    }
  });

  return { status: 'success', synced: synced, skipped: skipped };
}
