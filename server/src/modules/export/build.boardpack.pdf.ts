import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import type { BoardPack } from './export.boardpack.data.js';

const ACCENT = '#2563eb'; // brand blue (matches the app + the other report PDFs)
const GRAY = '#64748b';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const pct = (f: number) => `${Math.round(f * 100)}%`;
const healthColor = (h: string) => (h === 'GREEN' ? GREEN : h === 'AMBER' ? AMBER : h === 'RED' ? RED : GRAY);
const HEALTH_RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

// Steering Committee Board Pack PDF — one governance document: portfolio health + top risks + open
// issues + the decisions the board is asked to make. Shares the corporate visual language of the
// per-project / portfolio report PDFs (navy cover band, RAG pill, BLUF box, KPI band, worst-first
// tables). Self-contained by the same convention those builders follow.
export function buildBoardPackPdf(data: BoardPack): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(ACCENT).fontSize(12).font('Helvetica-Bold').text(text, left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const table = (cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | number)[][], emptyMsg?: string) => {
    if (!rows.length && emptyMsg) { doc.fillColor(GRAY).font('Helvetica').fontSize(9).text(emptyMsg, left, doc.y); doc.moveDown(0.4); return; }
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale = totalW > width ? width / totalW : 1;
    const cw = cols.map((c) => c.w * scale);
    const tableW = cw.reduce((s, w) => s + w, 0);
    const colX: number[] = [];
    let x = left;
    for (const w of cw) { colX.push(x); x += w; }
    const rowH = 15;
    // PDFKit's `ellipsis` only truncates once wrapping engages; with a fixed row height a long
    // single-line cell wraps and overlaps the next row, so clip by measured width instead.
    const clip = (s: string, w: number) => {
      if (doc.widthOfString(s) <= w) return s;
      let str = s;
      while (str.length > 1 && doc.widthOfString(`${str}…`) > w) str = str.slice(0, -1);
      return `${str}…`;
    };
    const drawRow = (cells: (string | number)[], bold: boolean, fill?: string) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      if (fill) doc.rect(left, y - 2, tableW, rowH).fill(fill);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold && fill ? '#ffffff' : '#0f172a');
      cols.forEach((c, i) => {
        doc.text(clip(String(cells[i] ?? ''), cw[i] - 4), colX[i] + 2, y, { width: cw[i] - 4, align: c.align ?? 'left', lineBreak: false });
      });
      doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.title), true, ACCENT);
    for (const r of rows) drawRow(r, false);
    doc.moveDown(0.4);
  };

  const t = data.summary.totals;
  const byHealth = data.summary.byHealth as Record<string, number>;
  const moneyShort = (v: number) => {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return `${s}Rp ${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}M`;
    if (a >= 1e6) return `${s}Rp ${Math.round(a / 1e6)}jt`;
    if (a >= 1e3) return `${s}Rp ${Math.round(a / 1e3)}rb`;
    return `Rp ${Math.round(v)}`;
  };
  const portHealth = t.pv <= 0 ? 'NO_DATA' : t.spi >= 0.95 ? 'GREEN' : t.spi >= 0.85 ? 'AMBER' : 'RED';
  const ragText = portHealth === 'GREEN' ? 'ON TRACK' : portHealth === 'AMBER' ? 'AT RISK' : portHealth === 'RED' ? 'OFF TRACK' : 'NO DATA';

  // ---------- Cover header band ----------
  const bandH = 92;
  doc.save();
  doc.rect(0, 0, pageW, bandH).fill('#0f172a');
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(19).text('PRISMATIX', left, 22, { lineBreak: false, characterSpacing: 1 });
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text(`STEERING COMMITTEE  ·  BOARD PACK  ·  ${t.count} PROJECT${t.count === 1 ? '' : 'S'}`, left, 50, { lineBreak: false, characterSpacing: 0.5 });
  doc.fillColor('#64748b').fontSize(8).text(`Status date ${iso(data.statusDate)}`, left, 64, { lineBreak: false });
  const pillW = 118, pillH = 28, pillX = right - pillW, pillY = 26;
  doc.roundedRect(pillX, pillY, pillW, pillH, 14).fill(healthColor(portHealth));
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(ragText, pillX, pillY + 9, { width: pillW, align: 'center', lineBreak: false });
  doc.restore();

  // ---------- Title + meta ----------
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text('Portfolio Governance Board Pack', left, bandH + 16, { width });
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`${t.count} project${t.count === 1 ? '' : 's'}    |    Status date ${iso(data.statusDate)}    |    Generated ${iso(data.generatedAt)}`, { width });

  // ---------- Executive summary (BLUF) ----------
  const red = byHealth.RED ?? 0, amber = byHealth.AMBER ?? 0;
  const critRisks = data.topRisks.filter((r) => r.severity === 'CRITICAL' || r.severity === 'HIGH').length;
  const sentences: string[] = [];
  sentences.push(`The portfolio of ${t.count} project${t.count === 1 ? '' : 's'} is ${ragText.toLowerCase()} overall at ${pct(t.percentComplete)} complete by earned value (${moneyShort(t.ev)} of a ${moneyShort(t.bac)} budget).`);
  if (t.pv > 0) sentences.push(`Aggregate schedule ${t.spi.toFixed(2)} SPI, cost ${t.ac > 0 ? `${t.cpi.toFixed(2)} CPI` : 'no actuals yet'}.`);
  if (red + amber > 0) {
    const parts: string[] = [];
    if (red > 0) parts.push(`${red} off-track (red)`);
    if (amber > 0) parts.push(`${amber} at-risk (amber)`);
    sentences.push(`${parts.join(' and ')} ${red + amber === 1 ? 'project needs' : 'projects need'} attention.`);
  }
  sentences.push(`The board is asked to review ${data.topRisks.length} top risk${data.topRisks.length === 1 ? '' : 's'}${critRisks ? ` (${critRisks} high/critical)` : ''}, ${data.topIssues.length} open issue${data.topIssues.length === 1 ? '' : 's'}, and to decide on ${data.decisions.length} change request${data.decisions.length === 1 ? '' : 's'}.`);
  const summary = sentences.join(' ');

  doc.moveDown(0.9);
  const boxPad = 9;
  doc.font('Helvetica').fontSize(9.5);
  const sumH = doc.heightOfString(summary, { width: width - 2 * boxPad });
  const boxY = doc.y;
  const boxTotalH = sumH + 2 * boxPad + 13;
  doc.save().roundedRect(left, boxY, width, boxTotalH, 4).fillAndStroke('#f8fafc', '#e2e8f0').restore();
  doc.save().rect(left, boxY, 3, boxTotalH).fill(ACCENT).restore();
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(8).text('EXECUTIVE SUMMARY', left + boxPad, boxY + boxPad, { width: width - 2 * boxPad, characterSpacing: 0.5 });
  doc.fillColor('#334155').font('Helvetica').fontSize(9.5).text(summary, left + boxPad, boxY + boxPad + 12, { width: width - 2 * boxPad });
  doc.y = boxY + boxTotalH;

  // ---------- KPI band (governance-focused) ----------
  doc.moveDown(0.7);
  const kpis: { label: string; value: string; color?: string }[] = [
    { label: 'Projects', value: String(t.count) },
    { label: '% Complete', value: pct(t.percentComplete) },
    { label: 'SPI', value: t.pv > 0 ? t.spi.toFixed(2) : '—', color: t.pv > 0 ? (t.spi >= 1 ? GREEN : RED) : undefined },
    { label: 'CPI', value: t.ac > 0 ? t.cpi.toFixed(2) : '—', color: t.ac > 0 ? (t.cpi >= 1 ? GREEN : RED) : undefined },
    { label: 'Open risks', value: String(data.topRisks.length), color: critRisks ? RED : undefined },
    { label: 'Decisions', value: String(data.decisions.length), color: data.decisions.length ? AMBER : undefined },
  ];
  const gap = 6, n = kpis.length, bw = (width - gap * (n - 1)) / n, bh = 46, ky = doc.y;
  kpis.forEach((it, i) => {
    const x = left + i * (bw + gap);
    doc.save().roundedRect(x, ky, bw, bh, 4).fillAndStroke('#ffffff', '#e2e8f0').restore();
    doc.fillColor('#94a3b8').font('Helvetica-Bold').fontSize(6.5).text(it.label.toUpperCase(), x + 6, ky + 8, { width: bw - 12, lineBreak: false, ellipsis: true });
    doc.fillColor(it.color ?? '#0f172a').font('Helvetica-Bold').fontSize(13).text(it.value, x + 6, ky + 21, { width: bw - 12, lineBreak: false, ellipsis: true });
  });
  doc.y = ky + bh;

  // ---------- 1. Portfolio health (per-project, worst-first) ----------
  heading('1. Portfolio Health');
  const projects = [...data.summary.projects].sort(
    (a, b) => (HEALTH_RANK[a.health] ?? 9) - (HEALTH_RANK[b.health] ?? 9) || a.spi - b.spi,
  );
  table(
    [
      { title: 'Code', w: 70 }, { title: 'Project', w: 150 }, { title: 'PM', w: 80 },
      { title: 'CPI', w: 35, align: 'right' }, { title: 'SPI', w: 35, align: 'right' },
      { title: '% Cpl', w: 40, align: 'right' }, { title: 'Health', w: 60 },
    ],
    projects.map((p) => [
      p.code, p.name, p.pm, p.cpi ? p.cpi.toFixed(2) : '—', p.spi ? p.spi.toFixed(2) : '—',
      pct(p.percentComplete), p.health === 'NO_DATA' ? 'No data' : p.health,
    ]),
    'No projects in scope.',
  );

  // ---------- 2. Top risks ----------
  heading('2. Top Risks');
  table(
    [
      { title: 'Project', w: 60 }, { title: 'Risk', w: 175 }, { title: 'Sev.', w: 55 },
      { title: 'EMV', w: 85, align: 'right' }, { title: 'Response', w: 70 }, { title: 'Owner', w: 75 },
    ],
    data.topRisks.map((r) => [
      r.project, r.title, titleCase(r.severity), r.emv ? formatIdr(r.emv) : '—',
      r.response ? titleCase(r.response) : '—', r.owner ?? '—',
    ]),
    'No open risks across the portfolio.',
  );
  if (data.topRisks.length) {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica').text('EMV = residual (post-response) exposure where set, else gross. Sorted by severity then exposure.', left, doc.y, { width });
  }

  // ---------- 3. Open issues ----------
  heading('3. Open Issues');
  table(
    [
      { title: 'Project', w: 60 }, { title: 'Issue', w: 210 }, { title: 'Impact', w: 55 },
      { title: 'Status', w: 70 }, { title: 'Age', w: 45, align: 'right' }, { title: 'Owner', w: 75 },
    ],
    data.topIssues.map((i) => [
      i.project, i.title, titleCase(i.impact), titleCase(i.status), `${i.ageDays}d`, i.owner ?? '—',
    ]),
    'No open issues across the portfolio.',
  );

  // ---------- 4. Decisions needed ----------
  heading('4. Decisions Needed');
  table(
    [
      { title: 'Project', w: 60 }, { title: 'Change request', w: 175 }, { title: 'Type', w: 60 },
      { title: 'Magnitude', w: 55 }, { title: 'Amount', w: 75, align: 'right' }, { title: 'Waiting', w: 45, align: 'right' },
    ],
    data.decisions.map((c) => [
      c.project, c.title, titleCase(c.type), titleCase(c.magnitude),
      c.amount ? formatIdr(c.amount) : '—', `${c.ageDays}d`,
    ]),
    'No change requests are awaiting a decision.',
  );
  if (data.decisions.length) {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica').text('Change requests submitted or under review, awaiting an approve/reject decision. Oldest-waiting first.', left, doc.y, { width });
  }

  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').moveDown(0.6)
    .text('Generated by Prismatix for steering-committee governance. Health aggregates each project’s EVM roll-up (WBS / agile points / hybrid). Risks, issues and change requests are the current live records across the projects in scope.', left, doc.y, { align: 'left', width });

  // ---------- Footer on every page ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // avoid PDFKit auto-adding a blank page when writing in the margin
    const fy = pageH - 30;
    doc.save();
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(left, fy).lineTo(right, fy).stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text('Prismatix — Steering Committee Board Pack', left, fy + 6, { width: width * 0.5, lineBreak: false, ellipsis: true });
    doc.text('CONFIDENTIAL · Internal', left, fy + 6, { width, align: 'center', lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left, fy + 6, { width, align: 'right', lineBreak: false });
    doc.restore();
  }

  doc.end();
  return done;
}
