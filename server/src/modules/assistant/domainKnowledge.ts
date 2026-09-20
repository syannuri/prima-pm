// Anett's domain-expertise knowledge base — a curated, GROUNDED reference so Anett can reason as the
// relevant TECHNICAL expert (network / infrastructure / security / SDLC / program) when a project's
// domain calls for it, WITHOUT the model inventing standard clause numbers, product versions, or CVE
// ids. Anett retrieves the relevant persona/topic via the domain_guidance tool and composes advice
// from it, framed in named industry standards (TOGAF, ITIL 4, NIST CSF, CIS Controls, ISO 27001,
// OWASP / SAMM, cloud Well-Architected, Uptime/TIA-942). Content is canonical terminology
// (English); Anett presents in the user's language. This is ADVISORY, not official guidance,
// certification, or a substitute for a named framework's own text.
//
// The trigger is the project's charter category (ProjectCategory) — resolvePersonasForCategory maps a
// category to the persona(s) Anett may adopt. This mirrors the PMI pattern in pmiKnowledge.ts.
// Referenced marks/standards belong to their respective bodies; this module paraphrases widely-
// published concepts for advisory use and does not reproduce their text.

export const DOMAIN_DISCLAIMER_ID =
  'Catatan: ini panduan advisory berbasis kerangka/standar industri (mis. TOGAF, ITIL, NIST, CIS, ISO 27001, OWASP), bukan nasihat resmi, sertifikasi, atau pengganti teks standar tersebut.';
export const DOMAIN_DISCLAIMER_EN =
  'Note: this is advisory guidance based on industry frameworks/standards (e.g. TOGAF, ITIL, NIST, CIS, ISO 27001, OWASP), not official advice, certification, or a substitute for the standards themselves.';

export interface DomainEntry {
  id: string;
  persona: string;       // Indonesian, user-facing persona label ("topi" yang dipakai Anett)
  personaEn: string;     // English persona label
  title: string;         // Indonesian, user-facing topic title
  standards: string[];   // named industry frameworks/standards this draws on
  aliases: string[];     // ID + EN keywords for fuzzy matching
  summary: string;
  expertiseAreas: string[]; // the sub-areas this persona is competent in
  guidance: string[];    // the recommendation points (canonical, framework-aligned terms)
  appSignals?: string[]; // app metrics/artifacts this maps to (category/charter/risk/SPI…) — the bridge
  related?: string[];
}

export const DOMAIN_KNOWLEDGE: DomainEntry[] = [
  // ── Program / portfolio management (cross-cutting; complements the PMI KB) ─────────────────────
  {
    id: 'program-management',
    persona: 'Pakar Manajemen Program',
    personaEn: 'Program Management Expert',
    title: 'Manajemen program & portofolio',
    standards: ['PMI Standard for Program Management / PgMP', 'MSP (Managing Successful Programmes)', 'PMI Portfolio Management'],
    aliases: ['program', 'programme', 'program management', 'manajemen program', 'portfolio', 'portofolio', 'benefits realization', 'realisasi manfaat', 'msp', 'pgmp', 'governance', 'tata kelola program', 'digital transformation', 'transformasi digital', 'roadmap'],
    summary: 'Mengoordinasikan sekelompok proyek terkait untuk mewujudkan manfaat yang tak bisa dicapai proyek terpisah, dengan tata kelola berjenjang.',
    expertiseAreas: ['benefits realization', 'program governance', 'stakeholder & dependency management lintas-proyek', 'roadmap & tranche planning', 'portfolio prioritization'],
    guidance: [
      'Manage the program for BENEFITS, not just deliverables: define a benefits realization plan (baseline → target → measure), and keep a benefits register mapped to component projects.',
      'Use tiered governance (MSP): a sponsoring group + SRO set direction; the program board manages tranches and cross-project dependencies/risks; component PMs deliver outputs.',
      'Plan in TRANCHES (increments that each deliver a step-change in capability) rather than a single big-bang; review benefits and viability at each tranche boundary.',
      'Actively manage cross-project DEPENDENCIES and shared resources — the program\'s main value and main risk both live at the interfaces between projects.',
      'Prioritize the portfolio on value vs effort/strategic fit; stop or re-scope components that no longer advance the target benefits.',
    ],
    appSignals: ['program hierarchy (parent/child projects)', 'cross-project dependencies', 'intake/portfolio scoring', 'DIGITAL_TRANSFORMATION category'],
    related: ['it-infrastructure'],
  },

  // ── Network architecture (Network Solution Architect + Network Architect) ─────────────────────
  {
    id: 'network-architecture',
    persona: 'Arsitek Jaringan / Network Solution Architect',
    personaEn: 'Network / Solution Architect',
    title: 'Arsitektur & solusi jaringan',
    standards: ['TOGAF (enterprise architecture)', 'hierarchical internetworking model (core/distribution/access)', 'IETF/IEEE networking standards', 'ITIL 4 (untuk operasi jaringan)'],
    aliases: ['network', 'jaringan', 'network architecture', 'arsitektur jaringan', 'network solution', 'solusi jaringan', 'lan', 'wan', 'sd-wan', 'sdwan', 'vlan', 'segmentation', 'segmentasi', 'routing', 'switching', 'bgp', 'ospf', 'topology', 'topologi', 'bandwidth', 'kapasitas jaringan', 'redundancy', 'redundansi', 'togaf'],
    summary: 'Merancang topologi jaringan yang skalabel, redundan, dan aman, menyeimbangkan kapasitas, latensi, dan biaya terhadap kebutuhan bisnis.',
    expertiseAreas: ['topology & hierarchical design (core/distribution/access)', 'routing & switching', 'segmentation & VLAN/VRF', 'WAN/SD-WAN & connectivity', 'capacity, redundancy & high availability', 'network security zoning'],
    guidance: [
      'Design top-down from requirements (TOGAF): capture bandwidth, latency, availability, and growth targets BEFORE choosing topology or vendor kit.',
      'Use a layered/hierarchical model (core / distribution / access) for scalability and fault isolation; avoid flat L2 domains that spread failures and broadcast storms.',
      'Build in REDUNDANCY at the layers that carry the availability target — dual paths, redundant devices, and no single point of failure on critical links; state the target as an availability SLO.',
      'SEGMENT the network by trust/function (VLAN/VRF, zones) so a compromise or fault is contained — coordinate segmentation with the security architecture.',
      'Size for capacity with headroom and a growth curve; validate latency-sensitive flows; document the addressing/routing plan as an architecture artifact, not tribal knowledge.',
    ],
    appSignals: ['NETWORK_INFRA category', 'availability/SLO requirements', 'capacity-related risks'],
    related: ['it-infrastructure', 'cybersecurity-infrastructure', 'server-infrastructure'],
  },

  // ── IT infrastructure / service management ────────────────────────────────────────────────────
  {
    id: 'it-infrastructure',
    persona: 'Pakar Infrastruktur IT',
    personaEn: 'IT Infrastructure Expert',
    title: 'Infrastruktur IT & manajemen layanan',
    standards: ['ITIL 4 (service management)', 'ISO/IEC 20000', 'TOGAF (technology architecture)'],
    aliases: ['it infrastructure', 'infrastruktur it', 'infrastructure', 'infrastruktur', 'itil', 'service management', 'manajemen layanan', 'availability', 'ketersediaan', 'capacity', 'kapasitas', 'change management', 'incident', 'insiden', 'problem management', 'sla', 'slo', 'system integration', 'integrasi sistem', 'monitoring', 'observability'],
    summary: 'Mengelola layanan IT end-to-end (ketersediaan, kapasitas, perubahan, insiden) agar andal dan selaras dengan kebutuhan bisnis.',
    expertiseAreas: ['service availability & capacity management', 'change enablement & release management', 'incident & problem management', 'monitoring/observability', 'technology architecture & integration'],
    guidance: [
      'Define services by the VALUE and SLA/SLO they deliver to the business, then engineer availability and capacity to meet those targets (ITIL 4 service value chain).',
      'Gate changes through change enablement: assess risk, schedule in a change window, keep a rollback plan — most outages are self-inflicted by unmanaged change.',
      'Run incident vs problem management separately: restore service fast (incident), then find and remove root cause (problem) so it does not recur.',
      'Instrument for observability (metrics, logs, traces) tied to the SLOs — you cannot manage availability/capacity you do not measure.',
      'For system integration, define clear interface contracts and idempotent/retry-safe exchanges; treat integration points as the highest-risk, most-tested part of the delivery.',
    ],
    appSignals: ['SYSTEM_INTEGRATION category', 'availability/SLA requirements', 'operational risks'],
    related: ['server-infrastructure', 'network-architecture', 'cybersecurity'],
  },

  // ── Server / compute / cloud / datacenter infrastructure ──────────────────────────────────────
  {
    id: 'server-infrastructure',
    persona: 'Pakar Infrastruktur Server & Cloud',
    personaEn: 'Server & Cloud Infrastructure Expert',
    title: 'Infrastruktur server, cloud & datacenter',
    standards: ['Cloud Well-Architected frameworks (AWS/Azure/GCP)', 'ITIL 4 (operasi)', 'Uptime Institute Tier / TIA-942 (datacenter)', 'ISO 22301 (kelangsungan bisnis)'],
    aliases: ['server', 'compute', 'komputasi', 'virtualization', 'virtualisasi', 'vm', 'hypervisor', 'cloud', 'aws', 'azure', 'gcp', 'well-architected', 'ha', 'high availability', 'ketersediaan tinggi', 'dr', 'disaster recovery', 'rpo', 'rto', 'backup', 'cadangan', 'datacenter', 'data center', 'pusat data', 'tier', 'storage', 'penyimpanan', 'scaling', 'capacity planning', 'kapasitas server'],
    summary: 'Merancang platform server/cloud yang andal, skalabel, dan hemat biaya dengan HA/DR yang sesuai target RPO/RTO.',
    expertiseAreas: ['compute/virtualization & container platforms', 'high availability & disaster recovery (RPO/RTO)', 'capacity & cost/performance optimization', 'backup & business continuity', 'datacenter tiering', 'cloud Well-Architected pillars'],
    guidance: [
      'Design against the Well-Architected pillars (operational excellence, security, reliability, performance efficiency, cost optimization, sustainability) — treat them as explicit trade-offs, not defaults.',
      'Derive HA/DR from stated RPO (max data loss) and RTO (max downtime) targets: pick the pattern (backup/restore → pilot-light → warm-standby → active-active) that MEETS the target at the LOWEST cost — do not gold-plate.',
      'TEST recovery, not just backups: an untested backup is an assumption. Run periodic restore/failover drills and record the actual achieved RPO/RTO.',
      'Right-size and plan capacity with headroom + autoscaling where it applies; track cost/performance so reliability is not bought with runaway spend.',
      'For datacenter builds, align redundancy (power/cooling/network) to the required Uptime Institute Tier / TIA-942 level; do not mix tier expectations across facilities.',
    ],
    appSignals: ['SERVER_INFRA / CLOUD_INFRA / DATACENTER category', 'RPO/RTO or availability requirements', 'continuity risks'],
    related: ['it-infrastructure', 'network-architecture', 'cybersecurity-infrastructure'],
  },

  // ── Cyber security (management / assurance) ───────────────────────────────────────────────────
  {
    id: 'cybersecurity',
    persona: 'Pakar Keamanan Siber',
    personaEn: 'Cyber Security Expert',
    title: 'Keamanan siber & manajemen risiko keamanan',
    standards: ['NIST Cybersecurity Framework (CSF)', 'ISO/IEC 27001 ISMS', 'OWASP Top 10', 'NIST SP 800-53 (control families)'],
    aliases: ['security', 'keamanan', 'cyber security', 'cybersecurity', 'keamanan siber', 'nist csf', 'iso 27001', 'isms', 'owasp', 'threat', 'ancaman', 'vulnerability', 'kerentanan', 'vuln', 'risk assessment', 'penilaian risiko', 'incident response', 'respons insiden', 'pentest', 'penetration test', 'compliance keamanan', 'security control', 'kontrol keamanan', 'data protection', 'perlindungan data'],
    summary: 'Mengelola risiko keamanan informasi end-to-end mengikuti NIST CSF / ISO 27001: identifikasi, lindungi, deteksi, respons, pulih.',
    expertiseAreas: ['security risk assessment', 'threat & vulnerability management', 'security controls & compliance (ISO 27001/NIST)', 'incident response', 'secure design review', 'data protection'],
    guidance: [
      'Structure the program around the NIST CSF functions — Identify, Protect, Detect, Respond, Recover — and manage security as ongoing RISK, not a one-time checklist.',
      'Run a risk assessment first (assets, threats, vulnerabilities, impact) and treat risks by priority; select controls proportionate to the assessed risk (ISO 27001 risk treatment).',
      'Maintain a vulnerability management cycle (discover → prioritize by exploitability/impact → remediate → verify); prioritize by real risk, not raw CVSS alone.',
      'Prepare incident response BEFORE an incident: an IR plan, defined roles, and rehearsed playbooks; the Detect/Respond/Recover functions decide the blast radius.',
      'Build security in via secure design review and OWASP-aligned checks; do not rely on a late pen-test to bolt security on at the end.',
    ],
    appSignals: ['CYBERSECURITY_INFRA category', 'security/compliance risks in the register', 'security requirements'],
    related: ['cybersecurity-infrastructure', 'sdlc', 'it-infrastructure'],
  },

  // ── Cyber security infrastructure (engineering / architecture) ────────────────────────────────
  {
    id: 'cybersecurity-infrastructure',
    persona: 'Pakar Infrastruktur Keamanan Siber',
    personaEn: 'Cyber Security Infrastructure Expert',
    title: 'Arsitektur & infrastruktur keamanan',
    standards: ['CIS Critical Security Controls', 'NIST SP 800-207 (Zero Trust Architecture)', 'ISO/IEC 27001 Annex A', 'defense-in-depth'],
    aliases: ['security infrastructure', 'infrastruktur keamanan', 'security architecture', 'arsitektur keamanan', 'zero trust', 'ztna', 'segmentation', 'segmentasi', 'firewall', 'ids', 'ips', 'siem', 'soc', 'iam', 'pam', 'identity', 'identitas', 'access control', 'kontrol akses', 'cis controls', 'hardening', 'baseline', 'endpoint', 'defense in depth', 'pertahanan berlapis', 'encryption', 'enkripsi'],
    summary: 'Merancang dan mengeraskan kontrol keamanan (identitas, segmentasi, deteksi) berlapis mengikuti CIS Controls & Zero Trust.',
    expertiseAreas: ['zero-trust architecture', 'identity & access (IAM/PAM)', 'network segmentation & perimeter (firewall/IDS/IPS)', 'secure baselines & hardening', 'logging/SIEM/SOC', 'encryption & key management'],
    guidance: [
      'Prioritize with the CIS Controls (Implementation Groups) — start with the foundational hygiene (asset & software inventory, secure configuration, access control, continuous vuln management) before advanced tooling.',
      'Move toward Zero Trust (NIST SP 800-207): never trust by network location; authenticate and authorize every access on identity + device posture; assume breach.',
      'Enforce least privilege via IAM/PAM: role/attribute-based access, MFA, just-in-time elevation for privileged accounts; access is the most-abused path.',
      'Layer defenses (defense-in-depth) and SEGMENT so lateral movement is contained; align network segmentation with the network architecture zones.',
      'Harden systems to a documented secure baseline, centralize logging into SIEM, and give the SOC the telemetry to detect — controls you cannot observe cannot be trusted.',
    ],
    appSignals: ['CYBERSECURITY_INFRA category', 'security architecture requirements', 'access/segmentation risks'],
    related: ['cybersecurity', 'network-architecture', 'server-infrastructure'],
  },

  // ── Software Development Lifecycle ────────────────────────────────────────────────────────────
  {
    id: 'sdlc',
    persona: 'Pakar Siklus Hidup Pengembangan Perangkat Lunak (SDLC)',
    personaEn: 'Software Development Lifecycle Expert',
    title: 'Siklus hidup pengembangan perangkat lunak (SDLC)',
    standards: ['OWASP SAMM / ASVS', 'secure SDLC (NIST SSDF SP 800-218)', 'CI/CD & DevSecOps practices', 'test pyramid'],
    aliases: ['sdlc', 'software development', 'pengembangan perangkat lunak', 'app dev', 'pengembangan aplikasi', 'ci/cd', 'cicd', 'devops', 'devsecops', 'testing', 'pengujian', 'qa', 'code review', 'tinjau kode', 'secure sdlc', 'owasp samm', 'asvs', 'ssdf', 'test pyramid', 'piramida pengujian', 'agile', 'requirements', 'kebutuhan', 'technical debt', 'utang teknis', 'release', 'rilis'],
    summary: 'Mengelola pengembangan perangkat lunak dari kebutuhan hingga rilis dengan kualitas & keamanan terbangun (secure SDLC, CI/CD, pengujian).',
    expertiseAreas: ['requirements & traceability', 'secure SDLC (OWASP SAMM / NIST SSDF)', 'CI/CD & release engineering', 'testing strategy (test pyramid)', 'code review & quality', 'technical-debt management'],
    guidance: [
      'Build security IN across the lifecycle (OWASP SAMM / NIST SSDF): threat-model in design, secure-code + review in build, security tests in CI — not a single gate at the end.',
      'Keep requirements traceable to tests and code so scope is verifiable (coverage/traceability); untraceable requirements are where scope silently drifts.',
      'Automate the pipeline (CI/CD) with quality gates: build, unit/integration tests, SAST/dependency scan, and a repeatable release; make rollback cheap.',
      'Balance the TEST PYRAMID — many fast unit tests, fewer integration, fewest end-to-end — instead of relying on slow, brittle manual testing.',
      'Manage technical debt explicitly (track it, budget paydown each iteration); unmanaged debt shows up later as slipping velocity and rising defect rates.',
    ],
    appSignals: ['APP_DEV / ENTERPRISE_APP category', 'requirements coverage/traceability', 'quality/scope risks', 'AGILE deliveryApproach'],
    related: ['cybersecurity', 'it-infrastructure'],
  },
];

// Fuzzy retrieval — longer phrase match scores higher (identical scoring to findPmiTopic).
export function findDomainTopic(query: string): DomainEntry | null {
  const q = query.toLowerCase();
  let best: DomainEntry | null = null;
  let bestScore = 0;
  for (const e of DOMAIN_KNOWLEDGE) {
    const hay = [e.id.replace(/-/g, ' '), e.title.toLowerCase(), e.personaEn.toLowerCase(), ...e.aliases.map((a) => a.toLowerCase())];
    let score = 0;
    for (const h of hay) if (h && q.includes(h)) score += h.length;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore > 0 ? best : null;
}

// Compact index (persona + title) for the system prompt so the model knows what it can ground on.
export function domainIndex(): string {
  return DOMAIN_KNOWLEDGE.map((e) => `${e.personaEn} (${e.title})`).join('; ');
}

// Map a project's charter category (ProjectCategory) to the domain persona(s) Anett may adopt.
// Deterministic; OTHER/unknown/null → [] (PM/Program only). program-management is also always
// available via the domain_guidance tool regardless of category (cross-cutting).
const CATEGORY_PERSONAS: Record<string, string[]> = {
  NETWORK_INFRA: ['network-architecture', 'it-infrastructure'],
  SERVER_INFRA: ['server-infrastructure', 'it-infrastructure'],
  CLOUD_INFRA: ['server-infrastructure', 'it-infrastructure'],
  DATACENTER: ['server-infrastructure', 'it-infrastructure'],
  CYBERSECURITY_INFRA: ['cybersecurity-infrastructure', 'cybersecurity'],
  APP_DEV: ['sdlc'],
  ENTERPRISE_APP: ['sdlc'],
  SYSTEM_INTEGRATION: ['it-infrastructure', 'sdlc'],
  DIGITAL_TRANSFORMATION: ['program-management'],
  DATA_ANALYTICS: ['sdlc'],
  AI_ML: ['sdlc'],
};

export function resolvePersonasForCategory(category: string | null | undefined): DomainEntry[] {
  if (!category) return [];
  const ids = CATEGORY_PERSONAS[category] ?? [];
  const byId = new Map(DOMAIN_KNOWLEDGE.map((e) => [e.id, e]));
  return ids.map((id) => byId.get(id)).filter((e): e is DomainEntry => Boolean(e));
}
