import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import type { ProjectReport } from '../report/report.service.js';

const ACCENT = '#e34f4a'; // brand coral (matches the app)
const GRAY = '#64748b';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const iso = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const healthColor = (h: string) => (h === 'GREEN' ? GREEN : h === 'AMBER' ? AMBER : h === 'RED' ? RED : GRAY);
const healthLabel = (h: string) => (h === 'NO_DATA' ? 'No data' : h);
const statusLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
// Performance-index RAG matching the app engine (>=0.95 green, >=0.85 amber, else red) — so the
// report's CPI/SPI colour & wording agree with the health pill instead of a binary >=1 cut-off.
const idxColor = (v: number) => (v >= 0.95 ? GREEN : v >= 0.85 ? AMBER : RED);
const schedWord = (v: number) => (v >= 0.95 ? 'on or ahead of plan' : v >= 0.85 ? 'slightly behind plan' : 'behind plan');
const costWord = (v: number) => (v >= 0.95 ? 'on or under budget' : v >= 0.85 ? 'slightly over budget' : 'over budget');
const schedTag = (v: number) => (v >= 0.95 ? '  (on/ahead)' : v >= 0.85 ? '  (watch)' : '  (behind)');
const costTag = (v: number) => (v >= 0.95 ? '  (on/under)' : v >= 0.85 ? '  (watch)' : '  (over)');

// A professional single-project status report PDF (period-aware). Mirrors the in-app
// Reports page: status summary, task completion, EVM, forecast and the EVM S-curve.
export function buildReportPdf(r: ProjectReport): Promise<Buffer> {
  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  const heading = (text: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    // Pin to the left margin: kv()/table() leave doc.x drifted (e.g. at the value column),
    // which would otherwise indent the next heading. Passing `left` forces left alignment.
    doc.fillColor(ACCENT).fontSize(12).font('Helvetica-Bold').text(text, left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const kv = (label: string, value: string, color?: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text(label, left, y, { width: 150 });
    doc.font('Helvetica').fillColor(color ?? '#0f172a').text(value, left + 160, y, { width: width - 160 });
    doc.moveDown(0.25);
  };

  const table = (cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | number)[][]) => {
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale = totalW > width ? width / totalW : 1;
    const cw = cols.map((c) => c.w * scale);
    const tableW = cw.reduce((s, w) => s + w, 0);
    const colX: number[] = [];
    let x = left;
    for (const w of cw) { colX.push(x); x += w; }
    const drawRow = (cells: (string | number)[], bold: boolean, fill?: string) => {
      const rowH = 16;
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      if (fill) doc.rect(left, y - 2, tableW, rowH).fill(fill);
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold && fill ? '#ffffff' : '#0f172a');
      cols.forEach((c, i) => {
        doc.text(String(cells[i] ?? ''), colX[i] + 2, y, { width: cw[i] - 4, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
      });
      doc.y = y + rowH;
    };
    drawRow(cols.map((c) => c.title), true, ACCENT);
    rows.forEach((row) => drawRow(row, false));
    doc.moveDown(0.4);
  };

  const f = r.forecast;
  const e = r.evm;
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const byCount = r.tasks.total ? Math.round((r.tasks.completed / r.tasks.total) * 100) : 0;
  // Compact IDR for KPI tiles: Rp NM / Rp Njt / Rp Nrb (base Helvetica has no rupiah glyph beyond "Rp").
  const moneyShort = (v: number) => {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return `${s}Rp ${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}M`;
    if (a >= 1e6) return `${s}Rp ${Math.round(a / 1e6)}jt`;
    if (a >= 1e3) return `${s}Rp ${Math.round(a / 1e3)}rb`;
    return `Rp ${Math.round(v)}`;
  };
  const ragText = r.health === 'GREEN' ? 'ON TRACK' : r.health === 'AMBER' ? 'AT RISK' : r.health === 'RED' ? 'OFF TRACK' : 'NO DATA';

  // ---------- Cover header band ----------
  const bandH = 92;
  doc.save();
  doc.rect(0, 0, pageW, bandH).fill('#0f172a');
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(19).text('PRISMATIX', left, 22, { lineBreak: false, characterSpacing: 1 });
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text(`PROJECT STATUS REPORT   ·   ${r.period.toUpperCase()}`, left, 50, { lineBreak: false, characterSpacing: 0.5 });
  doc.fillColor('#64748b').fontSize(8).text(r.periodLabel, left, 64, { lineBreak: false });
  // RAG status pill, top-right.
  const pillW = 118, pillH = 28, pillX = right - pillW, pillY = 26;
  doc.roundedRect(pillX, pillY, pillW, pillH, 14).fill(healthColor(r.health));
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(ragText, pillX, pillY + 9, { width: pillW, align: 'center', lineBreak: false });
  doc.restore();

  // ---------- Title + meta ----------
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text(`${r.project.code} — ${r.project.name}`, left, bandH + 16, { width });
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`PM ${r.project.pmName}    |    ${statusLabel(r.project.status)}    |    ${r.periodLabel}    |    Generated ${iso(r.asOf)}`, { width });

  // ---------- Executive summary (BLUF) ----------
  const sentences: string[] = [];
  sentences.push(`Overall status is ${ragText.toLowerCase()} at ${r.tasks.weightedPct}% complete by weighted value (${byCount}% by task count, ${r.tasks.completed} of ${r.tasks.total} work packages done).`);
  if (e.pv > 0) {
    const v = f.schedule.varianceDays;
    sentences.push(`Schedule performance is ${e.spi.toFixed(2)} SPI — ${schedWord(e.spi)}${v != null ? `, forecast finish ${v > 0 ? `${v} day${v === 1 ? '' : 's'} late` : v < 0 ? `${-v} day${v === -1 ? '' : 's'} early` : 'on the baseline date'}` : ''}.`);
  }
  if (e.ac > 0) sentences.push(`Cost performance is ${e.cpi.toFixed(2)} CPI — ${costWord(e.cpi)}; estimate at completion ${moneyShort(f.eac.likely)} against a ${moneyShort(e.bac)} budget (VAC ${moneyShort(f.vac)}).`);
  const overdue = r.tasks.remaining.filter((t) => t.overdue).length;
  if (overdue > 0) sentences.push(`${overdue} work package${overdue === 1 ? '' : 's'} currently overdue and need${overdue === 1 ? 's' : ''} attention.`);
  const summary = sentences.join(' ');

  doc.moveDown(0.9);
  const boxPad = 9;
  doc.font('Helvetica').fontSize(9.5);
  const sumH = doc.heightOfString(summary, { width: width - 2 * boxPad });
  const boxY = doc.y;
  const boxTotalH = sumH + 2 * boxPad + 13;
  doc.save().roundedRect(left, boxY, width, boxTotalH, 4).fillAndStroke('#f8fafc', '#e2e8f0').restore();
  doc.save().rect(left, boxY, 3, boxTotalH).fill(ACCENT).restore(); // accent spine
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(8).text('EXECUTIVE SUMMARY', left + boxPad, boxY + boxPad, { width: width - 2 * boxPad, characterSpacing: 0.5 });
  doc.fillColor('#334155').font('Helvetica').fontSize(9.5).text(summary, left + boxPad, boxY + boxPad + 12, { width: width - 2 * boxPad });
  doc.y = boxY + boxTotalH;

  // ---------- KPI band ----------
  doc.moveDown(0.7);
  const kpis: { label: string; value: string; color?: string }[] = [
    { label: '% Complete', value: `${r.tasks.weightedPct}%` },
    { label: 'SPI', value: e.pv > 0 ? e.spi.toFixed(2) : '—', color: e.pv > 0 ? idxColor(e.spi) : undefined },
    { label: 'CPI', value: e.ac > 0 ? e.cpi.toFixed(2) : '—', color: e.ac > 0 ? idxColor(e.cpi) : undefined },
    { label: 'EAC (likely)', value: moneyShort(f.eac.likely), color: f.eac.likely > e.bac ? RED : undefined },
    { label: 'VAC', value: moneyShort(f.vac), color: f.vac < 0 ? RED : GREEN },
    { label: 'Forecast finish', value: f.schedule.forecastFinish ? iso(f.schedule.forecastFinish) : '—' },
  ];
  const gap = 6, n = kpis.length, bw = (width - gap * (n - 1)) / n, bh = 46, ky = doc.y;
  kpis.forEach((it, i) => {
    const x = left + i * (bw + gap);
    doc.save().roundedRect(x, ky, bw, bh, 4).fillAndStroke('#ffffff', '#e2e8f0').restore();
    doc.fillColor('#94a3b8').font('Helvetica-Bold').fontSize(6.5).text(it.label.toUpperCase(), x + 6, ky + 8, { width: bw - 12, lineBreak: false, ellipsis: true });
    doc.fillColor(it.color ?? '#0f172a').font('Helvetica-Bold').fontSize(13).text(it.value, x + 6, ky + 21, { width: bw - 12, lineBreak: false, ellipsis: true });
  });
  doc.y = ky + bh;

  // ---------- 1. Status summary ----------
  heading('1. Status Summary');
  kv('Overall health', healthLabel(r.health), healthColor(r.health));
  kv('% Complete (weighted)', `${r.tasks.weightedPct}%`);
  kv('Tasks completed', `${r.tasks.completed} of ${r.tasks.total}  (${r.tasks.inProgress} in progress, ${r.tasks.notStarted} not started)`);
  kv('Schedule (SPI)', e.pv > 0 ? `${e.spi.toFixed(2)}${e.spi >= 1 ? '  (on/ahead)' : '  (behind)'}` : '—', e.pv > 0 ? (e.spi >= 1 ? GREEN : RED) : GRAY);
  kv('Cost (CPI)', e.ac > 0 ? `${e.cpi.toFixed(2)}${e.cpi >= 1 ? '  (on/under)' : '  (over)'}` : '—', e.ac > 0 ? (e.cpi >= 1 ? GREEN : RED) : GRAY);
  kv('Planned finish', iso(f.schedule.plannedFinish));
  kv('Forecast finish', f.schedule.forecastFinish ? `${iso(f.schedule.forecastFinish)}${f.schedule.varianceDays != null ? `  (${f.schedule.varianceDays > 0 ? '+' : ''}${f.schedule.varianceDays}d)` : ''}` : '—',
    f.schedule.varianceDays != null ? (f.schedule.varianceDays > 0 ? RED : GREEN) : undefined);

  // ---------- 2. Task completion ----------
  heading('2. Task Completion');
  kv('Completed', `${r.tasks.completed}`, GREEN);
  kv('In progress', `${r.tasks.inProgress}`, AMBER);
  kv('Not started', `${r.tasks.notStarted}`, GRAY);
  kv('By task count', `${r.tasks.total ? Math.round((r.tasks.completed / r.tasks.total) * 100) : 0}%  (${r.tasks.completed}/${r.tasks.total})`);
  kv('By weighted value', `${r.tasks.weightedPct}%  (EVM roll-up — reflects budget/effort, not task count)`);
  if (r.tasks.remaining.length) {
    doc.moveDown(0.2).font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text('Remaining / uncompleted work:', left, doc.y);
    doc.moveDown(0.2);
    table(
      [
        { title: 'Task', w: 210 }, { title: 'Owner', w: 110 }, { title: 'Due', w: 70 },
        { title: '%', w: 35, align: 'right' }, { title: 'Flag', w: 70 },
      ],
      r.tasks.remaining.map((t) => [
        `${t.isMilestone ? '* ' : ''}${t.name}`, t.owner ?? '—', iso(t.planEnd), `${t.pct}%`, t.overdue ? 'OVERDUE' : '',
      ]),
    );
  } else {
    doc.text('All work packages complete.', left, doc.y);
  }

  // ---------- 3. Schedule detail (plan vs actual) ----------
  if (r.tasks.schedule.length) {
    heading('3. Schedule Detail (plan vs actual)');
    table(
      [
        { title: 'Task', w: 150 },
        { title: 'Plan start', w: 66, align: 'right' }, { title: 'Actual start', w: 66, align: 'right' },
        { title: 'Plan finish', w: 66, align: 'right' }, { title: 'Actual finish', w: 66, align: 'right' },
        { title: '%', w: 32, align: 'right' },
      ],
      r.tasks.schedule.map((t) => [
        `${t.isMilestone ? '* ' : ''}${t.name}`,
        iso(t.planStart), iso(t.actualStart), iso(t.planEnd), iso(t.actualFinish), `${t.pct}%`,
      ]),
    );
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
      .text('Actual start is stamped on first progress; actual finish when a task reaches 100%. "—" = not yet reached. * = milestone.', left, doc.y, { width });
  }

  // ---------- 4. Earned Value (EVM) ----------
  heading('4. Earned Value (EVM)');
  table(
    [{ title: 'Metric', w: 240 }, { title: 'Value', w: 275, align: 'right' }],
    [
      ['Budget at Completion (BAC)', formatIdr(e.bac)],
      ['Planned Value (PV)', formatIdr(e.pv)],
      ['Earned Value (EV)', formatIdr(e.ev)],
      ['Actual Cost (AC)', formatIdr(e.ac)],
      ['Cost Performance Index (CPI)', e.ac > 0 ? e.cpi.toFixed(3) : '—'],
      ['Schedule Performance Index (SPI)', e.pv > 0 ? e.spi.toFixed(3) : '—'],
      ['% Complete (weighted)', `${r.tasks.weightedPct}%`],
    ],
  );

  // ---------- 5. Forecast ----------
  heading('5. Forecast (Estimate at Completion)');
  table(
    [{ title: 'Forecast', w: 240 }, { title: 'Value', w: 275, align: 'right' }],
    [
      ['EAC — optimistic (to plan)', formatIdr(f.eac.optimistic)],
      ['EAC — likely (BAC / CPI)', formatIdr(f.eac.likely)],
      ['EAC — pessimistic (cost+schedule drag)', formatIdr(f.eac.pessimistic)],
      ['Estimate to Complete (ETC)', formatIdr(f.etc)],
      ['Variance at Completion (VAC)', formatIdr(f.vac)],
      ['To-Complete Performance Index (TCPI)', f.bac > f.ac ? f.tcpi.toFixed(3) : '—'],
      // ASCII "->" — PDFKit's base Helvetica has no Unicode arrow glyph (renders as garbage).
      ['Planned finish -> Forecast finish', `${iso(f.schedule.plannedFinish)} -> ${iso(f.schedule.forecastFinish)}`],
    ],
  );
  if (f.margin.revenue > 0) {
    kv('Contract revenue', formatIdr(f.margin.revenue));
    kv('Planned margin', formatIdr(f.margin.planned));
    kv('Projected margin (at likely EAC)', formatIdr(f.margin.projected), f.margin.projected < 0 ? RED : GREEN);
  }

  // ---------- 5. Project chart — EVM S-curve (vector line chart, then exact figures) ----------
  if (f.sCurve.length) {
    heading(`6. Project chart — EVM S-curve (${r.period})`);
    const pts = f.sCurve;
    const padL = 42; // left gutter for the y-axis (money) labels
    const cX = left + padL;
    const cW = width - padL;
    const cH = 160;
    if (doc.y > doc.page.height - (cH + 90)) doc.addPage();
    const cY = doc.y + 4;
    const xs = pts.map((p) => +new Date(p.t));
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const now = +new Date(r.asOf);
    const vals: number[] = [e.bac];
    pts.forEach((p) => { vals.push(p.pv); if (p.ac != null) vals.push(p.ac); if (p.forecast != null) vals.push(p.forecast); });
    const yMax = Math.max(1, ...vals) * 1.08;
    const X = (t: number) => cX + (xMax > xMin ? ((t - xMin) / (xMax - xMin)) * cW : 0);
    const Y = (v: number) => cY + cH - (v / yMax) * cH;
    const shortRp = (v: number) => `Rp ${Math.round(v / 1e6)}jt`;

    doc.save();
    // Horizontal gridlines + y-axis money labels in the left gutter.
    doc.font('Helvetica').fontSize(6.5);
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4;
      const y = Y(v);
      doc.strokeColor('#eef2f7').lineWidth(0.6).moveTo(cX, y).lineTo(cX + cW, y).stroke();
      doc.fillColor('#94a3b8').text(shortRp(v), left, y - 3, { width: padL - 6, align: 'right' });
    }
    // BAC dashed reference line.
    const bacY = Y(e.bac);
    doc.dash(3, { space: 2 }).strokeColor('#94a3b8').lineWidth(0.8).moveTo(cX, bacY).lineTo(cX + cW, bacY).stroke().undash();
    doc.fillColor('#64748b').fontSize(6.5).text(`BAC ${shortRp(e.bac)}`, cX + 2, bacY - 8, { width: 90 });
    // "Today" vertical marker.
    if (now >= xMin && now <= xMax && xMax > xMin) {
      const tx = X(now);
      doc.dash(2, { space: 2 }).strokeColor('#cbd5e1').lineWidth(0.8).moveTo(tx, cY).lineTo(tx, cY + cH).stroke().undash();
      doc.fillColor('#94a3b8').fontSize(6.5).text('today', tx - 7, cY - 1, { width: 30 });
    }
    // A PV/AC/forecast polyline.
    const line = (sel: (p: (typeof pts)[number]) => number | null, color: string, dashed: boolean) => {
      const seq = pts.map((p) => ({ t: +new Date(p.t), v: sel(p) })).filter((d): d is { t: number; v: number } => d.v != null);
      if (!seq.length) return;
      if (dashed) doc.dash(3, { space: 2 }); else doc.undash();
      doc.strokeColor(color).lineWidth(1.4);
      seq.forEach((d, i) => (i === 0 ? doc.moveTo(X(d.t), Y(d.v)) : doc.lineTo(X(d.t), Y(d.v))));
      doc.stroke().undash();
    };
    line((p) => p.pv, '#334155', false); // Planned Value (slate)
    line((p) => p.ac, '#0284c7', false); // Actual Cost (sky)
    line((p) => p.forecast, ACCENT, true); // Forecast to EAC (coral, dashed)
    // Axis frame.
    doc.strokeColor('#cbd5e1').lineWidth(0.8).moveTo(cX, cY).lineTo(cX, cY + cH).lineTo(cX + cW, cY + cH).stroke();
    doc.restore();

    // X-axis date labels (start / end) + legend below the plot.
    doc.fillColor('#94a3b8').font('Helvetica').fontSize(6.5);
    doc.text(iso(new Date(xMin).toISOString()), cX, cY + cH + 3, { width: 80 });
    doc.text(iso(new Date(xMax).toISOString()), cX + cW - 70, cY + cH + 3, { width: 70, align: 'right' });
    let lx = cX;
    const legendY = cY + cH + 16;
    for (const [lbl, col] of [['Planned (PV)', '#334155'], ['Actual (AC)', '#0284c7'], ['Forecast', ACCENT]] as const) {
      doc.save().strokeColor(col).lineWidth(2).moveTo(lx, legendY + 4).lineTo(lx + 14, legendY + 4).stroke().restore();
      doc.fillColor('#475569').fontSize(7.5).font('Helvetica').text(lbl, lx + 18, legendY, { width: 90 });
      lx += 18 + doc.widthOfString(lbl) + 16;
    }
    doc.y = legendY + 16;

    // Exact figures below the chart.
    table(
      [
        { title: 'Date', w: 90 }, { title: 'Planned Value (PV)', w: 150, align: 'right' },
        { title: 'Actual Cost (AC)', w: 140, align: 'right' }, { title: 'Forecast', w: 135, align: 'right' },
      ],
      f.sCurve.map((p) => [iso(p.t), formatIdr(p.pv), p.ac != null ? formatIdr(p.ac) : '—', p.forecast != null ? formatIdr(p.forecast) : '—']),
    );
  }

  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').moveDown(0.5)
    .text('Generated by Prismatix. EVM figures use the project’s delivery methodology (WBS / agile points / hybrid). % complete (weighted) reflects budget & effort, which can differ from a simple task count.', left, doc.y, { align: 'left', width });

  // ---------- Footer on every page (project · classification · page N) ----------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Writing below the bottom margin makes PDFKit auto-add a page; zero the bottom margin
    // for this page so the footer sits in the margin area without spawning blank pages.
    doc.page.margins.bottom = 0;
    const fy = pageH - 30;
    doc.save();
    doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(left, fy).lineTo(right, fy).stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
    doc.text(`${r.project.code} — ${r.project.name}`, left, fy + 6, { width: width * 0.5, lineBreak: false, ellipsis: true });
    doc.text('CONFIDENTIAL · Internal', left, fy + 6, { width, align: 'center', lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left, fy + 6, { width, align: 'right', lineBreak: false });
    doc.restore();
  }

  doc.end();
  return done;
}
