import ExcelJS from 'exceljs';
import { categoryLabel, flattenGantt, type ProjectExport } from './export.data.js';

const IDR = '"Rp"#,##0;[Red]-"Rp"#,##0';
const num = (v: unknown) => (v == null ? 0 : Number(v));

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    c.alignment = { vertical: 'middle' };
  });
}

export async function buildProjectWorkbook(data: ProjectExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Precise';
  wb.created = data.generatedAt;

  // --- Overview ---
  const ov = wb.addWorksheet('Overview');
  ov.columns = [{ width: 26 }, { width: 60 }];
  ov.addRow(['Project Code', data.project.code]);
  ov.addRow(['Project Name', data.project.name]);
  ov.addRow(['Client', data.project.clientName ?? '—']);
  ov.addRow(['Status', data.project.status]);
  ov.addRow(['Project Manager', data.project.pm?.name ?? '—']);
  ov.addRow(['Sponsor', data.project.sponsor ?? '—']);
  ov.addRow(['Generated', data.generatedAt.toISOString()]);
  ov.getColumn(1).font = { bold: true };

  // --- Charter ---
  const ch = wb.addWorksheet('Charter');
  ch.columns = [{ width: 26 }, { width: 80 }];
  const c = data.charter;
  if (c) {
    const rows: [string, string | number][] = [
      ['Description', c.description],
      ['Goals', c.goals],
      ['Category', categoryLabel(c.category)],
      ['High-Level Scope', c.hiScope],
      ['High-Level Cost (IDR)', num(c.hiCostIdr)],
      ['Schedule Start', new Date(c.hiScheduleStart).toISOString().slice(0, 10)],
      ['Schedule End', new Date(c.hiScheduleEnd).toISOString().slice(0, 10)],
      ['Deliverables', c.hiDeliverables],
      ['Status', c.locked ? `Committed (v${c.version})` : 'Draft'],
    ];
    rows.forEach((r) => ch.addRow(r));
    ch.getColumn(1).font = { bold: true };
    ch.getColumn(2).alignment = { wrapText: true };
    ch.getCell('B5').numFmt = IDR;
  } else {
    ch.addRow(['Charter not created yet']);
  }

  // --- Cost ---
  const co = wb.addWorksheet('Cost');
  co.columns = [{ width: 22 }, { width: 34 }, { width: 30 }, { width: 20 }];
  styleHeader(co.addRow(['Direct Cost — Type', 'Item', 'Detail', 'Amount (IDR)']));
  for (const d of data.cost.directCosts) {
    const detail =
      d.type === 'MANPOWER'
        ? `${d.personnelRole} · ${num(d.unitCostPerManday).toLocaleString('id-ID')}/md × ${num(d.planMandays)} md`
        : `${num(d.qty)} × ${num(d.unitCost).toLocaleString('id-ID')}`;
    const amount = d.type === 'MANPOWER' ? num(d.manpowerCost) : num(d.amount);
    const row = co.addRow([d.type, d.label, detail, amount]);
    row.getCell(4).numFmt = IDR;
  }
  co.addRow([]);
  styleHeader(co.addRow(['Indirect Cost — Type', 'Description', '', 'Amount (IDR)']));
  for (const i of data.cost.indirectCosts) {
    const row = co.addRow([i.type, i.description, '', num(i.amount)]);
    row.getCell(4).numFmt = IDR;
  }
  co.addRow([]);
  const b = data.cost.baseline;
  const baselineRows: [string, number][] = [
    ['Direct Total', num(b?.directTotal)],
    ['Indirect Total', num(b?.indirectTotal)],
    ['Contingency Reserve', num(b?.contingencyReserve)],
    ['Management Reserve', num(b?.managementReserve)],
    ['Budget at Completion / PMB (BAC)', num(b?.costBaseline)],
    ['Total Budget (BAC + Mgmt Reserve)', num(b?.budgetAtCompletion)],
  ];
  styleHeader(co.addRow(['Baseline Summary', '', '', '']));
  baselineRows.forEach(([label, val]) => {
    const row = co.addRow([label, '', '', val]);
    row.getCell(1).font = { bold: true };
    row.getCell(4).numFmt = IDR;
  });

  // --- Risk ---
  const ri = wb.addWorksheet('Risk');
  ri.columns = [
    { width: 8 }, { width: 36 }, { width: 12 }, { width: 6 }, { width: 6 }, { width: 8 },
    { width: 12 }, { width: 10 }, { width: 18 }, { width: 18 }, { width: 14 },
  ];
  styleHeader(ri.addRow(['Code', 'Title', 'Kind', 'P', 'I', 'Score', 'Severity', 'Prob %', 'Impact (IDR)', 'EMV (IDR)', 'In Reserve']));
  for (const r of data.risks) {
    const row = ri.addRow([
      r.code, r.title, r.kind, r.probabilityScore, r.impactScore, r.riskScore, r.severity,
      num(r.probabilityPct), num(r.impactCostIdr), num(r.emv), r.includeInReserve ? 'Yes' : 'No',
    ]);
    row.getCell(9).numFmt = IDR;
    row.getCell(10).numFmt = IDR;
    row.getCell(8).numFmt = '0%';
  }
  ri.addRow([]);
  const reserveRow = ri.addRow(['Contingency Reserve (Σ residual EMV of threats):', '', '', '', '', '', '', '', '', data.riskAnalysis.reserve.contingencyReserve, '']);
  reserveRow.font = { bold: true };
  reserveRow.getCell(10).numFmt = IDR;

  // --- Issue Log ---
  const isw = wb.addWorksheet('Issues');
  isw.columns = [
    { width: 8 }, { width: 40 }, { width: 16 }, { width: 10 }, { width: 18 },
    { width: 14 }, { width: 12 }, { width: 12 }, { width: 50 },
  ];
  styleHeader(isw.addRow(['Code', 'Issue', 'Category', 'Impact', 'Owner', 'Status', 'Raised', 'Resolved', 'Resolution']));
  const isoD = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
  for (const is of data.issues) {
    const row = isw.addRow([
      is.code, is.title, is.category ?? '—', is.impact, is.owner?.name ?? '—',
      is.status.replace('_', ' '), isoD(is.raisedAt), isoD(is.resolvedAt), is.resolution ?? '—',
    ]);
    row.getCell(9).alignment = { wrapText: true };
  }
  if (!data.issues.length) isw.addRow(['—', 'No issues logged']);

  // --- Schedule ---
  const sc = wb.addWorksheet('Schedule');
  sc.columns = [
    { width: 10 }, { width: 40 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 18 }, { width: 10 }, { width: 18 }, { width: 12 },
  ];
  styleHeader(sc.addRow(['WBS', 'Task', 'Plan Start', 'Plan End', 'Actual Start', 'Actual Finish', 'PIC', 'Progress', 'Budget (IDR)', 'Mandays']));
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
  for (const t of flattenGantt(data.gantt.tree)) {
    const row = sc.addRow([
      t.wbsCode, `${'    '.repeat(t.depth)}${t.name}`, iso(t.planStart), iso(t.planEnd),
      iso(t.actualStart), iso(t.actualFinish), t.pic, t.progressPct / 100, t.budgetCost, t.linkedPlanMandays,
    ]);
    row.getCell(8).numFmt = '0%';
    row.getCell(9).numFmt = IDR;
  }
  sc.addRow([]);
  const e = data.evm;
  styleHeader(sc.addRow(['EVM Metric', 'Value', '', '', '', '', '', '', '', '']));
  const evmRows: [string, string | number][] = [
    ['Planned Value (PV)', e.pv], ['Earned Value (EV)', e.ev], ['Actual Cost (AC)', e.ac],
    ['CPI', e.cpi], ['SPI', e.spi], ['EAC', e.eac], ['Health', e.health],
  ];
  evmRows.forEach(([label, val]) => {
    const row = sc.addRow([label, val]);
    row.getCell(1).font = { bold: true };
    if (typeof val === 'number' && label.match(/PV|EV|AC|EAC/)) row.getCell(2).numFmt = IDR;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
