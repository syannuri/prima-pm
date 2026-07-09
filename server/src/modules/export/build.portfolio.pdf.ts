import PDFDocument from 'pdfkit';
import { formatIdr } from '../../calc/money.js';
import type { PortfolioExport } from './export.portfolio.data.js';

const ACCENT = '#e34f4a'; // brand coral (matches the app + per-project report)
const GRAY = '#64748b';
const GREEN = '#16a34a';
const AMBER = '#d97706';
const RED = '#dc2626';
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const pct = (f: number) => `${Math.round(f * 100)}%`;
const healthColor = (h: string) => (h === 'GREEN' ? GREEN : h === 'AMBER' ? AMBER : h === 'RED' ? RED : GRAY);
const statusLabel = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
// Worst-first ranking, matching the Executive on-screen heatmap sort.
const HEALTH_RANK: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2, NO_DATA: 3 };

// Portfolio-wide PDF report, styled to match the corporate per-project report
// (build.report.pdf.ts): a navy cover band + RAG pill, an auto-written executive
// summary, a KPI band, a health-distribution bar, the per-project EVM table
// (worst-first) and the rolled-up EVM trend.
export function buildPortfolioPdf(data: PortfolioExport): Promise<Buffer> {
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
    // Pin to the left margin: kv()/table() leave doc.x drifted (e.g. at the value column).
    doc.fillColor(ACCENT).fontSize(12).font('Helvetica-Bold').text(text, left, doc.y);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).strokeColor(ACCENT).lineWidth(1).stroke();
    doc.moveDown(0.5).fillColor('#0f172a').font('Helvetica').fontSize(9);
  };

  const kv = (label: string, value: string, color?: string) => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(GRAY).fontSize(9).text(label, left, y, { width: 160 });
    doc.font('Helvetica').fillColor(color ?? '#0f172a').text(value, left + 170, y, { width: width - 170 });
    doc.moveDown(0.2);
  };

  const table = (cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: (string | number)[][]) => {
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale = totalW > width ? width / totalW : 1;
    const cw = cols.map((c) => c.w * scale);
    const tableW = cw.reduce((s, w) => s + w, 0);
    const colX: number[] = [];
    let x = left;
    for (const w of cw) { colX.push(x); x += w; }
    const rowH = 15;
    // PDFKit's `ellipsis` only truncates reliably when wrapping is engaged; with a fixed
    // row height a long single-line cell wraps and overlaps the next row. Clip manually.
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
  // Compact IDR for KPI tiles (base Helvetica has no rupiah glyph beyond "Rp").
  const moneyShort = (v: number) => {
    const a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e9) return `${s}Rp ${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}M`;
    if (a >= 1e6) return `${s}Rp ${Math.round(a / 1e6)}jt`;
    if (a >= 1e3) return `${s}Rp ${Math.round(a / 1e3)}rb`;
    return `Rp ${Math.round(v)}`;
  };
  // Portfolio-level schedule health from the aggregate SPI (same thresholds as per-project).
  const portHealth = t.pv <= 0 ? 'NO_DATA' : t.spi >= 0.95 ? 'GREEN' : t.spi >= 0.85 ? 'AMBER' : 'RED';
  const ragText = portHealth === 'GREEN' ? 'ON TRACK' : portHealth === 'AMBER' ? 'AT RISK' : portHealth === 'RED' ? 'OFF TRACK' : 'NO DATA';

  // ---------- Cover header band ----------
  const bandH = 92;
  doc.save();
  doc.rect(0, 0, pageW, bandH).fill('#0f172a');
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(19).text('PRISMATIX', left, 22, { lineBreak: false, characterSpacing: 1 });
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(9).text(`PORTFOLIO STATUS REPORT   ·   ${t.count} PROJECT${t.count === 1 ? '' : 'S'}`, left, 50, { lineBreak: false, characterSpacing: 0.5 });
  doc.fillColor('#64748b').fontSize(8).text(`Status date ${iso(data.statusDate)}`, left, 64, { lineBreak: false });
  // RAG status pill, top-right.
  const pillW = 118, pillH = 28, pillX = right - pillW, pillY = 26;
  doc.roundedRect(pillX, pillY, pillW, pillH, 14).fill(healthColor(portHealth));
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11).text(ragText, pillX, pillY + 9, { width: pillW, align: 'center', lineBreak: false });
  doc.restore();

  // ---------- Title + meta ----------
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(16).text('Portfolio EVM Overview', left, bandH + 16, { width });
  doc.font('Helvetica').fontSize(9).fillColor(GRAY)
    .text(`${t.count} project${t.count === 1 ? '' : 's'}    |    Status date ${iso(data.statusDate)}    |    Generated ${iso(data.generatedAt)}`, { width });

  // ---------- Executive summary (BLUF) ----------
  const red = byHealth.RED ?? 0, amber = byHealth.AMBER ?? 0;
  const sentences: string[] = [];
  sentences.push(`The portfolio of ${t.count} project${t.count === 1 ? '' : 's'} is ${ragText.toLowerCase()} overall at ${pct(t.percentComplete)} complete by earned value (${moneyShort(t.ev)} of a ${moneyShort(t.bac)} budget).`);
  if (t.pv > 0) sentences.push(`Aggregate schedule performance is ${t.spi.toFixed(2)} SPI — ${t.spi >= 1 ? 'on or ahead of plan' : 'behind plan'}.`);
  if (t.ac > 0) sentences.push(`Aggregate cost performance is ${t.cpi.toFixed(2)} CPI — ${t.cpi >= 1 ? 'on or under budget' : 'over budget'}, ${moneyShort(t.ac)} spent to date.`);
  if (red + amber > 0) {
    const parts: string[] = [];
    if (red > 0) parts.push(`${red} off-track (red)`);
    if (amber > 0) parts.push(`${amber} at-risk (amber)`);
    sentences.push(`${parts.join(' and ')} ${red + amber === 1 ? 'project needs' : 'projects need'} attention.`);
  } else if (t.pv > 0) {
    sentences.push('No projects are currently off-track or at-risk on schedule.');
  }
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
    { label: 'Projects', value: String(t.count) },
    { label: '% Complete', value: pct(t.percentComplete) },
    { label: 'SPI', value: t.pv > 0 ? t.spi.toFixed(2) : '—', color: t.pv > 0 ? (t.spi >= 1 ? GREEN : RED) : undefined },
    { label: 'CPI', value: t.ac > 0 ? t.cpi.toFixed(2) : '—', color: t.ac > 0 ? (t.cpi >= 1 ? GREEN : RED) : undefined },
    { label: 'BAC', value: moneyShort(t.bac) },
    { label: 'Earned value', value: moneyShort(t.ev) },
  ];
  const gap = 6, n = kpis.length, bw = (width - gap * (n - 1)) / n, bh = 46, ky = doc.y;
  kpis.forEach((it, i) => {
    const x = left + i * (bw + gap);
    doc.save().roundedRect(x, ky, bw, bh, 4).fillAndStroke('#ffffff', '#e2e8f0').restore();
    doc.fillColor('#94a3b8').font('Helvetica-Bold').fontSize(6.5).text(it.label.toUpperCase(), x + 6, ky + 8, { width: bw - 12, lineBreak: false, ellipsis: true });
    doc.fillColor(it.color ?? '#0f172a').font('Helvetica-Bold').fontSize(13).text(it.value, x + 6, ky + 21, { width: bw - 12, lineBreak: false, ellipsis: true });
  });
  doc.y = ky + bh;

  // ---------- Schedule-health distribution bar ----------
  const order: { key: string; label: string }[] = [
    { key: 'RED', label: 'Off-track' }, { key: 'AMBER', label: 'At-risk' },
    { key: 'GREEN', label: 'On-track' }, { key: 'NO_DATA', label: 'No data' },
  ];
  const totalProjects = order.reduce((s, o) => s + (byHealth[o.key] ?? 0), 0);
  if (totalProjects > 0) {
    doc.moveDown(0.7);
    doc.fillColor('#94a3b8').font('Helvetica-Bold').fontSize(6.5).text('SCHEDULE HEALTH', left, doc.y, { characterSpacing: 0.5 });
    doc.moveDown(0.2);
    const barY = doc.y, barH = 14;
    let bx = left;
    for (const o of order) {
      const cnt = byHealth[o.key] ?? 0;
      if (!cnt) continue;
      const segW = (cnt / totalProjects) * width;
      doc.rect(bx, barY, segW, barH).fill(healthColor(o.key));
      if (segW > 16) doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8).text(String(cnt), bx, barY + 3, { width: segW, align: 'center', lineBreak: false });
      bx += segW;
    }
    doc.y = barY + barH + 4;
    // Legend.
    let lx = left;
    const legendY = doc.y;
    for (const o of order) {
      const cnt = byHealth[o.key] ?? 0;
      if (!cnt) continue;
      doc.save().rect(lx, legendY + 1, 8, 8).fill(healthColor(o.key)).restore();
      const lbl = `${o.label} (${cnt})`;
      doc.fillColor('#475569').font('Helvetica').fontSize(7.5).text(lbl, lx + 11, legendY, { lineBreak: false });
      lx += 11 + doc.widthOfString(lbl) + 14;
    }
    doc.y = legendY + 12;
  }

  // ---------- 1. Portfolio totals ----------
  heading('1. Portfolio Totals');
  kv('Budget at Completion (BAC)', formatIdr(t.bac));
  kv('Planned Value (PV)', formatIdr(t.pv));
  kv('Earned Value (EV)', formatIdr(t.ev));
  kv('Actual Cost (AC)', formatIdr(t.ac));
  kv('Portfolio CPI', t.ac > 0 ? t.cpi.toFixed(3) : '—', t.ac > 0 ? (t.cpi >= 1 ? GREEN : RED) : GRAY);
  kv('Portfolio SPI', t.pv > 0 ? t.spi.toFixed(3) : '—', t.pv > 0 ? (t.spi >= 1 ? GREEN : RED) : GRAY);
  kv('% Complete (EV / BAC)', pct(t.percentComplete));
  kv('Schedule progress (WBS)', pct(t.scheduleProgress));

  // ---------- 2. Per-project EVM (worst-first) ----------
  heading('2. Projects');
  const projects = [...data.summary.projects].sort(
    (a, b) => (HEALTH_RANK[a.health] ?? 9) - (HEALTH_RANK[b.health] ?? 9) || a.spi - b.spi,
  );
  table(
    [
      { title: 'Code', w: 70 }, { title: 'Project', w: 120 }, { title: 'PM', w: 70 },
      { title: 'Status', w: 55 }, { title: 'BAC', w: 80, align: 'right' }, { title: 'EV', w: 80, align: 'right' },
      { title: 'CPI', w: 30, align: 'right' }, { title: 'SPI', w: 30, align: 'right' }, { title: 'Health', w: 55 },
    ],
    projects.map((p) => [
      p.code, p.name, p.pm, statusLabel(p.status), formatIdr(p.bac), formatIdr(p.ev),
      p.cpi ? p.cpi.toFixed(2) : '—', p.spi ? p.spi.toFixed(2) : '—', p.health === 'NO_DATA' ? 'No data' : p.health,
    ]),
  );

  // ---------- 3. Portfolio EVM trend ----------
  heading('3. EVM Trend (portfolio status history)');
  if (data.trend.series.length) {
    table(
      [
        { title: 'Status Date', w: 70 }, { title: 'Projects', w: 55, align: 'right' },
        { title: 'PV', w: 90, align: 'right' }, { title: 'EV', w: 90, align: 'right' },
        { title: 'AC', w: 90, align: 'right' }, { title: 'CPI', w: 35, align: 'right' },
        { title: 'SPI', w: 35, align: 'right' },
      ],
      data.trend.series.map((s) => [
        iso(s.statusDate), String(s.projectCount),
        formatIdr(s.pv), formatIdr(s.ev), formatIdr(s.ac),
        s.cpi ? s.cpi.toFixed(2) : '—', s.spi ? s.spi.toFixed(2) : '—',
      ]),
    );
  } else {
    doc.text('No portfolio snapshots captured yet.', left, doc.y);
  }

  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica').moveDown(0.5)
    .text('Generated by Prismatix. Portfolio figures aggregate each project’s EVM roll-up using its delivery methodology (WBS / agile points / hybrid). Schedule health is derived from the aggregate SPI.', left, doc.y, { align: 'left', width });

  // ---------- Footer on every page (portfolio · classification · page N) ----------
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
    doc.text('Prismatix — Portfolio Report', left, fy + 6, { width: width * 0.5, lineBreak: false, ellipsis: true });
    doc.text('CONFIDENTIAL · Internal', left, fy + 6, { width, align: 'center', lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, left, fy + 6, { width, align: 'right', lineBreak: false });
    doc.restore();
  }

  doc.end();
  return done;
}
