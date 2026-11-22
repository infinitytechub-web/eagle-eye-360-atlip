import type { Role } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super Administrator',
  system_admin: 'System Administrator',
  supervisor: 'Security / Command Supervisor',
  analyst: 'Intelligence Analyst',
  operator: 'Traffic Monitoring Operator',
  support_officer: 'Technical Support Officer',
  auditor: 'Read-only Auditor',
};
export const ROLE_CAN: Record<Role, string> = {
  super_admin: 'All modules, branding, user management',
  system_admin: 'Users, configuration, backups',
  supervisor: 'Security centre, approvals, broadcasts, evidence deletion',
  analyst: 'Analytics, reports, evidence creation',
  operator: 'Dashboard, detection, CCTV registration, alerts',
  support_officer: 'Devices, camera health, ticket handling',
  auditor: 'Read-only; exports logged',
};
export const ROLES = Object.keys(ROLE_LABEL) as Role[];

/** Mirrors the database RLS policies so the UI never offers an action the server will refuse. */
const P = {
  admins: ['super_admin', 'system_admin'],
  command: ['super_admin', 'system_admin', 'supervisor'],
  writers: ['super_admin', 'system_admin', 'supervisor', 'analyst', 'operator', 'support_officer'],
} as const;
export const perms = {
  viewAdmin: (r?: Role) => !!r && ['super_admin', 'system_admin', 'supervisor', 'auditor'].includes(r),
  manageUsers: (r?: Role) => !!r && (P.admins as readonly string[]).includes(r),
  branding: (r?: Role) => r === 'super_admin',
  registerCamera: (r?: Role) => !!r && ['super_admin', 'system_admin', 'supervisor', 'operator', 'support_officer'].includes(r),
  recordDetection: (r?: Role) => !!r && (P.writers as readonly string[]).includes(r),
  ackAlert: (r?: Role) => !!r && ['super_admin', 'system_admin', 'supervisor', 'analyst', 'operator'].includes(r),
  createEvidence: (r?: Role) => !!r && ['super_admin', 'system_admin', 'supervisor', 'analyst'].includes(r),
  designateModel: (r?: Role) => !!r && (P.command as readonly string[]).includes(r),
  issueNotif: (r?: Role) => !!r && (P.command as readonly string[]).includes(r),
  broadcast: (r?: Role) => !!r && (P.command as readonly string[]).includes(r),
  write: (r?: Role) => !!r && r !== 'auditor',
  handleTickets: (r?: Role) => !!r && ['super_admin', 'system_admin', 'supervisor', 'support_officer'].includes(r),
  liveUsers: (r?: Role) => !!r && (P.command as readonly string[]).includes(r),
  readAudit: (r?: Role) => !!r && ['super_admin', 'system_admin', 'supervisor', 'auditor'].includes(r),
};
