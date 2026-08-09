import ExcelJS from 'exceljs';
import { BadRequest } from '../../lib/errors.js';
import { createTask } from '../schedule/schedule.service.js';

// Excel/CSV task import (T4.3) — the inbound half of the WBS export. Parses an uploaded sheet into
// validated task rows (dry-run preview), then creates them via the normal schedule service (so the
// same guards apply: chartered, baseline unlocked, PIC checks). All-or-nothing: a commit is refused
// unless every row is valid.

export interface ParsedTaskRow {
  rowNum: number; // 1-based source row (for error messages)
  wbsCode?: string;
  name: string;
  planStart: Date;
  planEnd: Date;
  progressPct: number;
  isMilestone: boolean;
}
export interface RowError { rowNum: number; message: string }
export interface ImportPreview { rows: ParsedTaskRow[]; errors: RowError[]; total: number }

// Header synonyms → our field. Compared case-insensitively with spaces/underscores stripped.
const HEADER_MAP: Record<string, keyof RawRow> = {
  wbs: 'wbsCode', wbscode: 'wbsCode', code: 'wbsCode',
  name: 'name', task: 'name', taskname: 'name',
  planstart: 'planStart', start: 'planStart', startdate: 'planStart',
  planend: 'planEnd', end: 'planEnd', enddate: 'planEnd', finish: 'planEnd',
  progress: 'progressPct', 'progress%': 'progressPct', progresspct: 'progressPct', percent: 'progressPct',
  milestone: 'isMilestone', ismilestone: 'isMilestone',
};
interface RawRow { wbsCode?: string; name?: string; planStart?: unknown; planEnd?: unknown; progressPct?: unknown; isMilestone?: unknown }

const normHeader = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '').trim();

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(+v) ? null : v;
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400 * 1000)); return Number.isNaN(+d) ? null : d; } // Excel serial
  if (typeof v === 'string' && v.trim()) { const d = new Date(v.trim()); return Number.isNaN(+d) ? null : d; }
  return null;
}
function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}
const cellText = (v: unknown): string => (v == null ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)).trim();

// Minimal quote-aware CSV line splitter (no dependency).
function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Turn a header row + a per-row cell reader into validated ParsedTaskRow[]. Shared by xlsx/csv.
function buildRows(headers: string[], readRow: (i: number) => (string | number | Date | null)[], count: number): ImportPreview {
  const fields = headers.map((h) => HEADER_MAP[normHeader(h)]);
  if (!fields.includes('name')) throw BadRequest('Missing a "Name" column in the sheet.');
  const rows: ParsedTaskRow[] = [];
  const errors: RowError[] = [];
  let total = 0;
  for (let r = 0; r < count; r++) {
    const cells = readRow(r);
    const raw: RawRow = {};
    fields.forEach((f, i) => { if (f) (raw as Record<string, unknown>)[f] = cells[i]; });
    // Skip fully blank rows.
    if (!cellText(raw.name) && !cellText(raw.wbsCode) && raw.planStart == null && raw.planEnd == null) continue;
    total++;
    const rowNum = r + 2; // +1 for 0-index, +1 for the header row
    const name = cellText(raw.name);
    const planStart = toDate(raw.planStart);
    const planEnd = toDate(raw.planEnd);
    if (name.length < 2) { errors.push({ rowNum, message: 'Name is required (min 2 chars).' }); continue; }
    if (!planStart) { errors.push({ rowNum, message: 'Plan Start is missing or not a date.' }); continue; }
    if (!planEnd) { errors.push({ rowNum, message: 'Plan End is missing or not a date.' }); continue; }
    if (planEnd.getTime() < planStart.getTime()) { errors.push({ rowNum, message: 'Plan End is before Plan Start.' }); continue; }
    let progressPct = Number(raw.progressPct ?? 0);
    if (!Number.isFinite(progressPct)) progressPct = 0;
    progressPct = Math.max(0, Math.min(100, Math.round(progressPct)));
    rows.push({ rowNum, wbsCode: cellText(raw.wbsCode) || undefined, name, planStart, planEnd, progressPct, isMilestone: toBool(raw.isMilestone) });
  }
  return { rows, errors, total };
}

export async function parseTaskUpload(buffer: Buffer, filename: string): Promise<ImportPreview> {
  const isCsv = /\.csv$/i.test(filename);
  if (isCsv) {
    const lines = buffer.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 1) throw BadRequest('The CSV is empty.');
    const headers = splitCsvLine(lines[0]);
    const dataLines = lines.slice(1).map(splitCsvLine);
    return buildRows(headers, (i) => dataLines[i], dataLines.length);
  }
  const wb = new ExcelJS.Workbook();
  // exceljs's load() wants its own Buffer type; cast Node's branded Buffer to the exact param type.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  // Prefer a sheet named Tasks/WBS/Schedule, else the first sheet.
  const ws = wb.worksheets.find((s) => /tasks|wbs|schedule/i.test(s.name)) ?? wb.worksheets[0];
  if (!ws) throw BadRequest('No worksheet found in the file.');
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (c) => headers.push(cellText(c.value)));
  const dataRows: (string | number | Date | null)[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: (string | number | Date | null)[] = [];
    for (let c = 1; c <= headers.length; c++) cells.push(row.getCell(c).value as string | number | Date | null);
    dataRows.push(cells);
  }
  return buildRows(headers, (i) => dataRows[i], dataRows.length);
}

// Create the parsed rows as tasks (validated caller-side). Sequential so wbs auto-codes stay ordered.
export async function commitTaskImport(projectId: string, rows: ParsedTaskRow[], actorId: string): Promise<{ created: number }> {
  let created = 0;
  for (const row of rows) {
    await createTask(projectId, {
      name: row.name,
      wbsCode: row.wbsCode,
      planStart: row.planStart,
      planEnd: row.planEnd,
      progressPct: row.progressPct,
      isMilestone: row.isMilestone,
      sortOrder: 0,
    }, actorId);
    created++;
  }
  return { created };
}
