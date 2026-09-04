// Anett's PMI/PMBOK advisory knowledge base — a curated, GROUNDED reference so Anett can give
// project-management recommendations framed in PMI standards WITHOUT the model inventing section
// numbers or misquoting the guide. Anett retrieves the relevant topic via the pmi_guidance tool and
// composes advice from it. PMBOK 7 (principles + performance domains) is the primary frame; PMBOK 6
// (process groups × knowledge areas) is kept as the still-widely-used operational complement, plus the
// EVM and Risk practice standards. Content is canonical PMI terminology (English); Anett presents in
// the user's language. This is ADVISORY, not official PMI guidance/certification.
//
// PMI, PMBOK, PMP are registered marks of the Project Management Institute. This module paraphrases
// widely-published concepts for advisory use; it does not reproduce PMI text.

export const PMI_DISCLAIMER_ID =
  'Catatan: ini panduan advisory berbasis kerangka PMI/PMBOK, bukan nasihat resmi atau sertifikasi PMI®.';
export const PMI_DISCLAIMER_EN =
  'Note: this is advisory guidance based on the PMI/PMBOK framework, not official PMI® advice or certification.';

export interface PmiEntry {
  id: string;
  title: string;        // Indonesian, user-facing
  standard: string;     // which PMI source frame this draws on
  aliases: string[];    // ID + EN keywords for fuzzy matching
  summary: string;
  guidance: string[];   // the recommendation points (canonical PMI terms)
  appSignals?: string[]; // app metrics/artifacts this maps to (SPI/CPI/EMV/CR/charter…) — the "signal → guidance" bridge
  related?: string[];
}

export const PMI_KNOWLEDGE: PmiEntry[] = [
  // ── PMBOK 7 — primary frame ──────────────────────────────────────────────────────────────────
  {
    id: 'principles',
    title: 'Prinsip manajemen proyek (PMBOK 7)',
    standard: 'PMBOK 7 — 12 Project Management Principles',
    aliases: ['principle', 'principles', 'prinsip', 'pmbok 7', 'pmbok7', 'value delivery', 'nilai'],
    summary: 'Dua-belas prinsip yang memandu perilaku & pengambilan keputusan tim proyek.',
    guidance: [
      'The 12 principles: 1) Be a diligent, respectful, caring Steward; 2) Create a collaborative project Team environment; 3) Effectively engage with Stakeholders; 4) Focus on Value; 5) Recognize, evaluate and respond to System interactions; 6) Demonstrate Leadership behaviours; 7) Tailor based on context; 8) Build Quality into processes and deliverables; 9) Navigate Complexity; 10) Optimize Risk responses; 11) Embrace Adaptability and resilience; 12) Enable Change to achieve the envisioned future state.',
      'Use principles to justify a recommendation ("Focus on value → deprioritize scope that does not advance the business case").',
    ],
    related: ['performance-domains', 'tailoring'],
  },
  {
    id: 'performance-domains',
    title: 'Performance domain (PMBOK 7)',
    standard: 'PMBOK 7 — 8 Project Performance Domains',
    aliases: ['performance domain', 'domain', 'performance domains', 'pmbok 7 domain'],
    summary: 'Delapan area hasil yang harus dikelola bersama sepanjang proyek.',
    guidance: [
      'The 8 domains: Stakeholders; Team; Development Approach & Life Cycle; Planning; Project Work; Delivery; Measurement; Uncertainty.',
      'They operate as an interacting system — a weakness in one (e.g. Measurement showing poor SPI/CPI) signals action in others (Planning, Uncertainty).',
    ],
    appSignals: ['SPI', 'CPI', 'schedule variance', 'risk register'],
    related: ['principles', 'measurement-evm'],
  },
  {
    id: 'development-approach',
    title: 'Pendekatan pengembangan & siklus hidup',
    standard: 'PMBOK 7 — Development Approach & Life Cycle domain',
    aliases: ['predictive', 'agile', 'hybrid', 'waterfall', 'life cycle', 'siklus hidup', 'pendekatan', 'development approach', 'iterative', 'incremental'],
    summary: 'Memilih predictive / agile / hybrid sesuai kepastian kebutuhan & kadensi penyerahan.',
    guidance: [
      'Predictive suits well-understood, stable scope; adaptive (agile) suits high uncertainty / evolving requirements; hybrid blends both.',
      'Select based on: requirement stability, risk, delivery cadence, stakeholder involvement, regulatory constraints.',
    ],
    appSignals: ['deliveryApproach (PREDICTIVE/AGILE)'],
    related: ['tailoring', 'planning'],
  },
  {
    id: 'tailoring',
    title: 'Tailoring (menyesuaikan pendekatan)',
    standard: 'PMBOK 7 — Tailoring',
    aliases: ['tailoring', 'menyesuaikan', 'adapt', 'sesuaikan', 'right-size'],
    summary: 'Menyesuaikan proses, metode, dan artefak dengan konteks proyek — bukan menyalin proses penuh.',
    guidance: [
      'Tailor to project size, complexity, risk, industry, and organizational maturity; more governance for higher stakes, lighter for simple work.',
      'Avoid both over-processing (waste) and under-processing (uncontrolled risk).',
    ],
    related: ['principles', 'development-approach'],
  },
  {
    id: 'measurement-evm',
    title: 'Pengukuran kinerja & EVM',
    standard: 'PMBOK 7 Measurement domain + Practice Standard for Earned Value Management',
    aliases: ['evm', 'earned value', 'spi', 'cpi', 'sv', 'cv', 'eac', 'etc', 'vac', 'tcpi', 'pengukuran', 'measurement', 'kinerja', 'performance measurement', 'bac', 'pv', 'ev', 'ac'],
    summary: 'Membaca SPI/CPI/EAC dan menerjemahkannya jadi tindakan sesuai praktik EVM PMI.',
    guidance: [
      'Baselines: PV (planned value), EV (earned value), AC (actual cost), BAC (budget at completion).',
      'Schedule: SV = EV − PV, SPI = EV/PV. SPI < 1 = behind schedule; SPI > 1 = ahead.',
      'Cost: CV = EV − AC, CPI = EV/AC. CPI < 1 = over budget; CPI > 1 = under budget.',
      'Forecast: EAC (estimate at completion), ETC (estimate to complete), VAC = BAC − EAC (negative = projected overrun), TCPI (to-complete performance index; > 1 means the remaining work must be more efficient than planned).',
      'Recommended actions by signal — SPI < ~0.9 & trending down: analyze the critical path, consider schedule compression (crashing = add resources at cost; fast-tracking = parallelize with added risk). CPI < ~0.9: root-cause the cost variance, re-estimate EAC, review scope/rate. Both low: escalate via integrated change control and re-baseline if a change is approved.',
    ],
    appSignals: ['SPI', 'CPI', 'EAC', 'TCPI', 'VAC', 'scheduleVarianceDays', 'BAC'],
    related: ['schedule-management', 'cost-management', 'integrated-change-control'],
  },
  {
    id: 'uncertainty-risk',
    title: 'Ketidakpastian & manajemen risiko',
    standard: 'PMBOK 7 Uncertainty domain + Practice Standard for Project Risk Management',
    aliases: ['risk', 'risiko', 'uncertainty', 'ketidakpastian', 'emv', 'contingency', 'kontingensi', 'response', 'respons', 'threat', 'opportunity', 'peluang', 'ancaman', 'raid'],
    summary: 'Menilai risiko (EMV) & memilih strategi respons sesuai praktik risiko PMI.',
    guidance: [
      'Assess: qualitative (probability × impact matrix) then, for key risks, quantitative (e.g. EMV = probability × impact; expected schedule/cost effect).',
      'Threat responses: Escalate, Avoid, Transfer, Mitigate, Accept. Opportunity responses: Escalate, Exploit, Share, Enhance, Accept.',
      'Reserves: contingency reserve for identified ("known-unknown") risks — part of the cost baseline; management reserve for unidentified risks — outside the baseline.',
      'A rising aggregate EMV or a high-severity risk without a response is the trigger to act.',
    ],
    appSignals: ['risk EMV', 'riskScore/severity', 'contingency reserve'],
    related: ['principles', 'measurement-evm'],
  },
  {
    id: 'stakeholder-engagement',
    title: 'Keterlibatan pemangku kepentingan',
    standard: 'PMBOK 7 Stakeholders domain (PMBOK 6: Stakeholder Management)',
    aliases: ['stakeholder', 'pemangku kepentingan', 'engagement', 'keterlibatan', 'komunikasi stakeholder', 'raci'],
    summary: 'Mengidentifikasi, menganalisis, dan melibatkan pemangku kepentingan secara efektif.',
    guidance: [
      'Identify → analyze (power/interest, influence) → plan engagement → monitor and adjust.',
      'Use an engagement assessment (unaware → resistant → neutral → supportive → leading) and close gaps between current and desired.',
    ],
    appSignals: ['stakeholder register'],
    related: ['principles', 'communications'],
  },
  {
    id: 'team-leadership',
    title: 'Tim & kepemimpinan',
    standard: 'PMBOK 7 Team domain',
    aliases: ['team', 'tim', 'leadership', 'kepemimpinan', 'motivasi', 'servant leadership', 'resource'],
    summary: 'Membangun lingkungan tim kolaboratif & menunjukkan perilaku kepemimpinan.',
    guidance: [
      'Foster shared ownership, a safe environment, and servant-leadership behaviours; clarify roles and decision authority.',
      'Resource management (PMBOK 6): estimate, acquire, develop, and manage the team and physical resources.',
    ],
    related: ['principles'],
  },

  // ── PMBOK 6 — operational complement ─────────────────────────────────────────────────────────
  {
    id: 'process-groups',
    title: 'Process group (PMBOK 6)',
    standard: 'PMBOK 6 — 5 Process Groups',
    aliases: ['process group', 'process groups', 'proses', 'grup proses', 'pmbok 6', 'pmbok6', 'initiating', 'planning', 'executing', 'monitoring', 'closing'],
    summary: 'Lima grup proses yang berulang sepanjang fase/proyek.',
    guidance: [
      'Initiating (authorize the project/phase — charter, stakeholders); Planning (define scope, schedule, cost, quality, resources, comms, risk, procurement, stakeholder); Executing (do the work, manage the team); Monitoring & Controlling (measure & control — EVM, integrated change control); Closing (finalize, hand over, lessons learned).',
      'They overlap and iterate; Monitoring & Controlling runs across all others.',
    ],
    related: ['knowledge-areas', 'measurement-evm'],
  },
  {
    id: 'knowledge-areas',
    title: 'Knowledge area (PMBOK 6)',
    standard: 'PMBOK 6 — 10 Knowledge Areas',
    aliases: ['knowledge area', 'knowledge areas', 'area pengetahuan', 'integration', 'scope', 'schedule', 'cost', 'quality', 'communications', 'procurement'],
    summary: 'Sepuluh area pengetahuan yang saling terkait dalam perencanaan & kendali.',
    guidance: [
      'Integration, Scope, Schedule, Cost, Quality, Resource, Communications, Risk, Procurement, Stakeholder.',
      'Integration Management ties them together (charter, project management plan, direct & manage work, monitor & control, integrated change control, close).',
    ],
    related: ['process-groups', 'integrated-change-control'],
  },
  {
    id: 'schedule-management',
    title: 'Manajemen jadwal',
    standard: 'PMBOK 6 Schedule Management',
    aliases: ['schedule', 'jadwal', 'critical path', 'jalur kritis', 'crashing', 'fast-track', 'fast tracking', 'kompresi jadwal', 'network', 'float', 'slack'],
    summary: 'Menyusun & mengendalikan jadwal; menangani slip dengan teknik kompresi.',
    guidance: [
      'Define activities → sequence → estimate durations → develop schedule (critical path / critical chain) → control.',
      'To recover slip: analyze the critical path; crashing (add resources, higher cost) or fast-tracking (run activities in parallel, higher risk); re-sequence; reduce scope via change control.',
    ],
    appSignals: ['SPI', 'scheduleVarianceDays', 'critical path'],
    related: ['measurement-evm', 'integrated-change-control'],
  },
  {
    id: 'cost-management',
    title: 'Manajemen biaya',
    standard: 'PMBOK 6 Cost Management',
    aliases: ['cost', 'biaya', 'budget', 'anggaran', 'cost baseline', 'funding', 'eac', 'contingency'],
    summary: 'Menyusun estimasi & cost baseline; mengendalikan biaya dengan CPI/EAC.',
    guidance: [
      'Estimate costs → determine budget (cost baseline = estimates + contingency reserve; funding requirements add management reserve) → control costs.',
      'On CPI < 1: root-cause (rates, rework, scope creep), re-forecast EAC, and act via integrated change control if a change is needed.',
    ],
    appSignals: ['CPI', 'EAC', 'VAC', 'BAC', 'cost baseline'],
    related: ['measurement-evm', 'integrated-change-control'],
  },
  {
    id: 'integrated-change-control',
    title: 'Kontrol perubahan terintegrasi',
    standard: 'PMBOK 6 Perform Integrated Change Control',
    aliases: ['change control', 'integrated change control', 'kontrol perubahan', 'change request', 'cr', 'ccb', 'baseline', 'rebaseline', 're-baseline', 'perubahan'],
    summary: 'Semua perubahan baseline lewat CR resmi & keputusan (CCB) untuk menjaga integritas baseline.',
    guidance: [
      'Every scope/schedule/cost change goes through a documented change request, impact analysis, and a decision by the change control board (or designated authority) before the baseline changes.',
      'Approved changes → update the affected baseline (re-baseline) and communicate; rejected/deferred changes are logged. This preserves EVM integrity (EV must be measured against a controlled baseline).',
    ],
    appSignals: ['ChangeRequest', 'baseline lock/unlock', 'pendingCRs'],
    related: ['measurement-evm', 'cost-management', 'schedule-management'],
  },
  {
    id: 'quality-management',
    title: 'Manajemen mutu',
    standard: 'PMBOK 6 Quality Management',
    aliases: ['quality', 'mutu', 'kualitas', 'cost of quality', 'coq', 'quality assurance', 'quality control'],
    summary: 'Merencanakan, mengelola, dan mengendalikan mutu; membangun mutu ke dalam proses.',
    guidance: [
      'Plan quality → manage quality (assurance, process improvement) → control quality (inspection/verification of deliverables).',
      'Consider cost of quality (prevention & appraisal vs internal/external failure); prevention is cheaper than correction.',
    ],
    related: ['principles'],
  },
  {
    id: 'procurement-management',
    title: 'Manajemen pengadaan',
    standard: 'PMBOK 6 Procurement Management',
    aliases: ['procurement', 'pengadaan', 'contract', 'kontrak', 'vendor', 'seller', 'make-or-buy'],
    summary: 'Merencanakan, melaksanakan, dan mengendalikan pengadaan & kontrak.',
    guidance: [
      'Plan procurement (make-or-buy, contract type) → conduct (source selection) → control (administer contracts, claims, close).',
      'Contract type shifts risk: fixed-price (seller bears cost risk) vs cost-reimbursable (buyer bears more) vs time & materials (hybrid).',
    ],
    related: ['knowledge-areas'],
  },
  {
    id: 'closing',
    title: 'Penutupan proyek/fase',
    standard: 'PMBOK 6 Close Project or Phase',
    aliases: ['closing', 'closeout', 'penutupan', 'tutup proyek', 'lessons learned', 'handover', 'serah terima'],
    summary: 'Menyelesaikan pekerjaan, serah-terima, dan menangkap pelajaran.',
    guidance: [
      'Confirm acceptance of deliverables, transition the product, release resources, finalize procurement, and record lessons learned into organizational process assets.',
    ],
    appSignals: ['closeout', 'lessons learned'],
    related: ['knowledge-areas'],
  },

  // ── The signal → recommendation bridge ───────────────────────────────────────────────────────
  {
    id: 'advise-from-metrics',
    title: 'Menerjemahkan metrik proyek jadi rekomendasi PMI',
    standard: 'PMI application to the project metrics this app computes',
    aliases: ['recommendation', 'rekomendasi', 'saran', 'advice', 'what should i do', 'apa yang harus', 'best practice', 'action', 'tindakan'],
    summary: 'Aturan praktis memetakan SPI/CPI/EMV/CR ke rekomendasi berbasis PMI.',
    guidance: [
      'SPI < 0.9 and declining → Schedule domain: analyze critical path; recommend crashing or fast-tracking; if scope must change, route via integrated change control.',
      'CPI < 0.9 → Cost domain: root-cause the variance, re-forecast EAC/VAC, review rates/scope; escalate via change control if corrective action changes the baseline.',
      'High or rising risk EMV / a severe risk with no response → Uncertainty: assign an owner and a response (avoid/transfer/mitigate/accept), verify contingency reserve.',
      'Many pending change requests → Integration: ensure integrated change control is applied and baselines re-based only on approval.',
      'Charter missing/incomplete → Initiating: complete and authorize the charter before planning/baseline.',
      'Always frame the recommendation in the relevant PMI principle/domain and state it is advisory.',
    ],
    appSignals: ['SPI', 'CPI', 'EMV', 'EAC', 'pendingCRs', 'charter'],
    related: ['measurement-evm', 'uncertainty-risk', 'integrated-change-control'],
  },
];

// Fuzzy match a free-text topic to the best PMI entry (word-overlap over id/title/aliases). Returns
// null when nothing plausibly matches, so the caller can offer the topic list instead of guessing.
export function findPmiTopic(query: string): PmiEntry | null {
  const q = query.toLowerCase();
  let best: PmiEntry | null = null;
  let bestScore = 0;
  for (const e of PMI_KNOWLEDGE) {
    const hay = [e.id.replace(/-/g, ' '), e.title.toLowerCase(), ...e.aliases.map((a) => a.toLowerCase())];
    let score = 0;
    for (const h of hay) if (h && q.includes(h)) score += h.length; // longer phrase match = stronger
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore > 0 ? best : null;
}

// Compact index (titles) for the system prompt so the model knows what it can ground on.
export function pmiIndex(): string {
  return PMI_KNOWLEDGE.map((e) => e.title).join('; ');
}
