import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFound } from '../../lib/errors.js';
import { computeEvmForProjects } from '../schedule/evm.batch.js';
import type { CreateProgramInput, UpdateProgramInput } from './program.schemas.js';

// Programs group projects for portfolio-level roll-up (Tier-3 hierarchy). Definitions are managed by
// ADMIN/PMO; any member may read them and the roll-up. Everything runs under the active tenant context,
// so the Prisma tenant extension scopes reads and stamps tenantId on writes.

const GLOBAL_ROLES: Role[] = ['ADMIN', 'PMO'];
const num = (d: unknown): number => (d == null ? 0 : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;

type Health = 'GREEN' | 'AMBER' | 'RED' | 'NO_DATA';
function scheduleHealth(spi: number, pv: number): Health {
  if (pv <= 0) return 'NO_DATA';
  if (spi >= 0.95) return 'GREEN';
  if (spi >= 0.85) return 'AMBER';
  return 'RED';
}
function costHealth(cpi: number, ac: number): Health {
  if (ac <= 0) return 'NO_DATA';
  if (cpi >= 0.95) return 'GREEN';
  if (cpi >= 0.85) return 'AMBER';
  return 'RED';
}

export interface ProgramDto {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  sponsor: string | null;
  managerUserId: string | null;
  archived: boolean;
  projectCount: number;
}

export async function listPrograms(opts: { includeArchived?: boolean } = {}): Promise<ProgramDto[]> {
  const rows = await prisma.program.findMany({
    where: opts.includeArchived ? {} : { archivedAt: null },
    orderBy: [{ createdAt: 'desc' }],
    include: { _count: { select: { projects: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    sponsor: p.sponsor,
    managerUserId: p.managerUserId,
    archived: p.archivedAt != null,
    projectCount: p._count.projects,
  }));
}

export async function createProgram(input: CreateProgramInput): Promise<ProgramDto> {
  const p = await prisma.program.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description,
      sponsor: input.sponsor,
      managerUserId: input.managerUserId,
    },
    include: { _count: { select: { projects: true } } },
  });
  return { id: p.id, code: p.code, name: p.name, description: p.description, sponsor: p.sponsor, managerUserId: p.managerUserId, archived: false, projectCount: p._count.projects };
}

export async function updateProgram(id: string, input: UpdateProgramInput): Promise<ProgramDto> {
  const existing = await prisma.program.findUnique({ where: { id } });
  if (!existing) throw NotFound('Program not found');
  const p = await prisma.program.update({
    where: { id },
    data: {
      code: input.code === undefined ? undefined : input.code,
      name: input.name,
      description: input.description === undefined ? undefined : input.description,
      sponsor: input.sponsor === undefined ? undefined : input.sponsor,
      managerUserId: input.managerUserId === undefined ? undefined : input.managerUserId,
      archivedAt: input.archived === undefined ? undefined : input.archived ? new Date() : null,
    },
    include: { _count: { select: { projects: true } } },
  });
  return { id: p.id, code: p.code, name: p.name, description: p.description, sponsor: p.sponsor, managerUserId: p.managerUserId, archived: p.archivedAt != null, projectCount: p._count.projects };
}

export async function deleteProgram(id: string): Promise<void> {
  const existing = await prisma.program.findUnique({ where: { id } });
  if (!existing) throw NotFound('Program not found');
  await prisma.program.delete({ where: { id } }); // projects detach via SET NULL
}

// Assign/detach a project to/from a program. Both must be in the active tenant (the extension enforces
// this on the update `where`).
export async function assignProject(programId: string, projectId: string): Promise<void> {
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program) throw NotFound('Program not found');
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw NotFound('Project not found');
  await prisma.project.update({ where: { id: projectId }, data: { programId } });
}

export async function unassignProject(programId: string, projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, programId: true } });
  if (!project || project.programId !== programId) throw NotFound('Project is not in this program');
  await prisma.project.update({ where: { id: projectId }, data: { programId: null } });
}

export interface ProgramRollup extends ProgramDto {
  bac: number;
  pv: number;
  ev: number;
  ac: number;
  spi: number;
  cpi: number;
  percentComplete: number;
  health: Health;
  costHealth: Health;
}

// Roll up EVM across each program's member projects, scoped to what the caller may see (a non-global
// role only counts projects they manage). Archived/deleted projects are excluded, mirroring the portfolio.
export async function getProgramRollups(userId: string, role: string, statusDate: Date): Promise<ProgramRollup[]> {
  const programs = await listPrograms({ includeArchived: false });
  if (programs.length === 0) return [];

  const where: {
    deletedAt: null; archivedAt: null; programId: { not: null }; pmUserId?: string;
  } = { deletedAt: null, archivedAt: null, programId: { not: null } };
  if (role !== 'GUEST' && !GLOBAL_ROLES.includes(role as Role)) where.pmUserId = userId;

  const projects = await prisma.project.findMany({
    where,
    select: { id: true, status: true, deliveryApproach: true, programId: true, costBaseline: { select: { costBaseline: true } } },
  });
  const evm = await computeEvmForProjects(projects, statusDate);

  const acc = new Map<string, { bac: number; pv: number; ev: number; ac: number; pctW: number; w: number; count: number }>();
  for (const p of projects) {
    if (!p.programId) continue;
    const e = evm.get(p.id);
    const a = acc.get(p.programId) ?? { bac: 0, pv: 0, ev: 0, ac: 0, pctW: 0, w: 0, count: 0 };
    const bac = num(p.costBaseline?.costBaseline);
    a.bac += bac;
    a.pv += e?.pv ?? 0;
    a.ev += e?.ev ?? 0;
    a.ac += e?.ac ?? 0;
    // BAC-weighted percent-complete (falls back to simple average when no baselines are set).
    a.pctW += (e?.percentComplete ?? 0) * (bac || 1);
    a.w += bac || 1;
    a.count += 1;
    acc.set(p.programId, a);
  }

  return programs.map((prog) => {
    const a = acc.get(prog.id) ?? { bac: 0, pv: 0, ev: 0, ac: 0, pctW: 0, w: 0, count: 0 };
    const spi = a.pv > 0 ? a.ev / a.pv : 0;
    const cpi = a.ac > 0 ? a.ev / a.ac : 0;
    return {
      ...prog,
      bac: round2(a.bac),
      pv: round2(a.pv),
      ev: round2(a.ev),
      ac: round2(a.ac),
      spi: round2(spi),
      cpi: round2(cpi),
      percentComplete: a.w > 0 ? round2(a.pctW / a.w) : 0,
      health: scheduleHealth(spi, a.pv),
      costHealth: costHealth(cpi, a.ac),
    };
  });
}
