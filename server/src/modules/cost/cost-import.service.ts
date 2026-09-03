import ExcelJS from 'exceljs';
import { BadRequest } from '../../lib/errors.js';
import { addDirectLine, addIndirectLine } from './cost.service.js';
import { DIRECT_TYPES, INDIRECT_TYPES, PERSONNEL_ROLES, type DirectLineInput, type IndirectLineInput } from './cost.schemas.js';

// Excel/CSV import for the Cost module — Direct and Indirect budget lines. Mirrors the task import
// (T4.3): parse an uploaded sheet into validated rows (dry-run preview), then create them via the
// normal cost service so the same derivations (amount, manpowerCost, sortOrder) and guards apply.
// All-or-nothing: a commit is refused unless every row is valid.

export interface RowError { rowNum: number; message: string }
export interface ImportPreview<T> { rows: T[]; errors: RowError[]; total: number }
export type ParsedDirectRow = DirectLineInput & { rowNum: number };
export type ParsedIndirectRow = IndirectLineInput & { rowNum: number };

// --- shared cell/sheet primitives (kept local so the task importer stays untouched) -------------
// Normalise a header to compare against the synonym maps: lower-case, drop every non-alphanumeric
// (spaces, underscores, hyphens, parens, %, …) so "Sub-Category" / "Rate per Man-day" still match.
const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const cellText = (v: unknown): string =>
  (v == null ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: unknown }).text) : String(v)).trim();

// Lenient number parse: accepts Excel numeric cells and strings with currency symbols / thousands
// separators (commas / spaces). Use plain numbers in the sheet to avoid locale ambiguity.
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[,\s]/g, '').replace(/[^\d.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Match a cell against an allowed enum set: normalise (upper, non-alnum → _) then compare.
function parseEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const norm = cellText(v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (allowed as readonly string[]).includes(norm) ? (norm as T) : null;
}

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

// Read a sheet (xlsx or csv) into { headers, dataRows }. For xlsx prefers a sheet whose name matches
// `preferSheet`, else the first.
async function readSheet(buffer: Buffer, filename: string, preferSheet: RegExp): Promise<{ headers: string[]; dataRows: unknown[][] }> {
  if (/\.csv$/i.test(filename)) {
    const lines = buffer.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 1) throw BadRequest('The CSV is empty.');
    return { headers: splitCsvLine(lines[0]), dataRows: lines.slice(1).map(splitCsvLine) };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets.find((s) => preferSheet.test(s.name)) ?? wb.worksheets[0];
  if (!ws) throw BadRequest('No worksheet found in the file.');
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c) => headers.push(cellText(c.value)));
  const dataRows: unknown[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= headers.length; c++) cells.push(row.getCell(c).value);
    dataRows.push(cells);
  }
  return { headers, dataRows };
}

// --- Direct ------------------------------------------------------------------------------------
// Keys are normHeader()-normalised (alphanumeric, lower-case).
const DIRECT_HEADERS: Record<string, string> = {
  type: 'type', category: 'type', costtype: 'type',
  label: 'label', item: 'label', name: 'label',
  subcategory: 'subCategory', subcat: 'subCategory', detail: 'subCategory',
  qty: 'qty', quantity: 'qty',
  unitcost: 'unitCost', price: 'unitCost',
  role: 'personnelRole', personnelrole: 'personnelRole',
  ratepermanday: 'unitCostPerManday', unitcostpermanday: 'unitCostPerManday', dayrate: 'unitCostPerManday',
  mandays: 'planMandays', planmandays: 'planMandays',
};

export async function parseDirectUpload(buffer: Buffer, filename: string): Promise<ImportPreview<ParsedDirectRow>> {
  const { headers, dataRows } = await readSheet(buffer, filename, /direct|cost|budget/i);
  const fields = headers.map((h) => DIRECT_HEADERS[normHeader(h)]);
  if (!fields.includes('type')) throw BadRequest('Missing a "Type" column in the sheet.');

  const rows: ParsedDirectRow[] = [];
  const errors: RowError[] = [];
  let total = 0;
  dataRows.forEach((cells, i) => {
    const raw: Record<string, unknown> = {};
    fields.forEach((f, j) => { if (f) raw[f] = cells[j]; });
    const rowNum = i + 2;
    // Skip fully blank rows.
    if (!cellText(raw.type) && !cellText(raw.label) && toNum(raw.qty) == null && toNum(raw.unitCost) == null && toNum(raw.planMandays) == null) return;
    total++;

    const type = parseEnum(raw.type, DIRECT_TYPES);
    if (!type) { errors.push({ rowNum, message: `Unknown Type "${cellText(raw.type)}". Use one of: ${DIRECT_TYPES.join(', ')}.` }); return; }
    const label = cellText(raw.label);
    const subCategory = cellText(raw.subCategory) || undefined;

    if (type === 'MANPOWER') {
      const role = parseEnum(raw.personnelRole, PERSONNEL_ROLES);
      const rate = toNum(raw.unitCostPerManday);
      const mandays = toNum(raw.planMandays);
      if (!label) { errors.push({ rowNum, message: 'Label is required.' }); return; }
      if (!role) { errors.push({ rowNum, message: `Role is required for manpower (${PERSONNEL_ROLES.join(' / ')}).` }); return; }
      if (rate == null || rate < 0) { errors.push({ rowNum, message: 'Rate per man-day is required (≥ 0).' }); return; }
      if (mandays == null || mandays < 0) { errors.push({ rowNum, message: 'Man-days is required (≥ 0).' }); return; }
      rows.push({ rowNum, type, label, personnelRole: role, unitCostPerManday: rate, planMandays: mandays });
    } else {
      const qty = toNum(raw.qty);
      const unitCost = toNum(raw.unitCost);
      if (!label) { errors.push({ rowNum, message: 'Label is required.' }); return; }
      if (qty == null || qty <= 0) { errors.push({ rowNum, message: 'Qty is required (> 0).' }); return; }
      if (unitCost == null || unitCost < 0) { errors.push({ rowNum, message: 'Unit Cost is required (≥ 0).' }); return; }
      if (type === 'OTHER' && !subCategory) { errors.push({ rowNum, message: 'Sub-Category is required when Type is OTHER.' }); return; }
      rows.push({ rowNum, type, label, subCategory, qty, unitCost });
    }
  });
  return { rows, errors, total };
}

export async function commitDirectImport(projectId: string, rows: ParsedDirectRow[], actorId: string): Promise<{ created: number }> {
  let created = 0;
  for (const { rowNum: _rowNum, ...input } of rows) {
    await addDirectLine(projectId, input, actorId);
    created++;
  }
  return { created };
}

// --- Indirect ----------------------------------------------------------------------------------
const INDIRECT_HEADERS: Record<string, string> = {
  type: 'type', category: 'type', costtype: 'type',
  description: 'description', label: 'description', item: 'description', name: 'description',
  subcategory: 'subCategory', subcat: 'subCategory', detail: 'subCategory',
  amount: 'amount', cost: 'amount', total: 'amount', value: 'amount',
};

export async function parseIndirectUpload(buffer: Buffer, filename: string): Promise<ImportPreview<ParsedIndirectRow>> {
  const { headers, dataRows } = await readSheet(buffer, filename, /indirect|cost|budget/i);
  const fields = headers.map((h) => INDIRECT_HEADERS[normHeader(h)]);
  if (!fields.includes('type')) throw BadRequest('Missing a "Type" column in the sheet.');
  if (!fields.includes('amount')) throw BadRequest('Missing an "Amount" column in the sheet.');

  const rows: ParsedIndirectRow[] = [];
  const errors: RowError[] = [];
  let total = 0;
  dataRows.forEach((cells, i) => {
    const raw: Record<string, unknown> = {};
    fields.forEach((f, j) => { if (f) raw[f] = cells[j]; });
    const rowNum = i + 2;
    if (!cellText(raw.type) && !cellText(raw.description) && toNum(raw.amount) == null) return;
    total++;

    const type = parseEnum(raw.type, INDIRECT_TYPES);
    if (!type) { errors.push({ rowNum, message: `Unknown Type "${cellText(raw.type)}". Use one of: ${INDIRECT_TYPES.join(', ')}.` }); return; }
    const description = cellText(raw.description);
    const subCategory = cellText(raw.subCategory) || undefined;
    const amount = toNum(raw.amount);
    if (!description) { errors.push({ rowNum, message: 'Description is required.' }); return; }
    if (amount == null || amount < 0) { errors.push({ rowNum, message: 'Amount is required (≥ 0).' }); return; }
    if (type === 'OTHER' && !subCategory) { errors.push({ rowNum, message: 'Sub-Category is required when Type is OTHER.' }); return; }
    rows.push({ rowNum, type, description, subCategory, amount });
  });
  return { rows, errors, total };
}

export async function commitIndirectImport(projectId: string, rows: ParsedIndirectRow[], actorId: string): Promise<{ created: number }> {
  let created = 0;
  for (const { rowNum: _rowNum, ...input } of rows) {
    await addIndirectLine(projectId, input, actorId);
    created++;
  }
  return { created };
}
