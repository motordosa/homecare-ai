import { HttpError } from './validation.mjs';

// These are server capabilities, not selectable UI modes. A display preference
// must never change the capabilities or patient scope returned here.
export const staffRoleCapabilities = Object.freeze({
  clinician: ['patient.read', 'clinical.write', 'workflow.write', 'workflow.review', 'correction.propose', 'correction.approve', 'research.read', 'research.export', 'evidence.read', 'evidence.review', 'notice.write', 'message.write', 'participation.write', 'delegation.write'],
  support: ['patient.read', 'workflow.write', 'correction.propose', 'evidence.read'],
  researcher: ['research.read', 'research.export', 'evidence.read', 'evidence.review'],
  administrator: ['delegation.write', 'admin.reset'],
});

const allCapabilities = [...new Set(Object.values(staffRoleCapabilities).flat())];
const denied = () => ({ staffRoles: [], capabilities: [], assignedPatientIds: [] });

export function staffAccessFor(identity, env = process.env) {
  if (!identity) return denied();
  if (identity.provider === 'demo') {
    return identity.role === 'clinician'
      ? { staffRoles: ['clinician'], capabilities: [...allCapabilities], assignedPatientIds: null }
      : denied();
  }
  if (identity.provider !== 'kakao') return denied();
  let policy = {};
  if (env.STAFF_ACCESS_JSON?.trim()) {
    try {
      policy = JSON.parse(env.STAFF_ACCESS_JSON);
      if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return denied();
    } catch { return denied(); }
  }
  if (Object.hasOwn(policy, identity.providerId)) {
    const entry = policy[identity.providerId];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        !Array.isArray(entry.roles) || entry.roles.length > 4 ||
        entry.roles.some(role => !Object.hasOwn(staffRoleCapabilities, role)) ||
        !Array.isArray(entry.patientIds) || entry.patientIds.length > 10000 ||
        entry.patientIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id))) return denied();
    const staffRoles = [...new Set(entry.roles)];
    return { staffRoles, capabilities: [...new Set(staffRoles.flatMap(role => staffRoleCapabilities[role]))], assignedPatientIds: [...new Set(entry.patientIds)].sort() };
  }
  const legacy = new Set((env.CLINICIAN_KAKAO_IDS || '').split(',').map(value => value.trim()).filter(value => /^\d{1,30}$/.test(value)));
  return legacy.has(identity.providerId)
    ? { staffRoles: ['clinician'], capabilities: [...staffRoleCapabilities.clinician], assignedPatientIds: null }
    : denied();
}

export function hasCapability(actor, capability) {
  return Boolean(actor?.accountId && actor.role === 'clinician' && Array.isArray(actor.capabilities) && actor.capabilities.includes(capability));
}

export function assignedPatientIds(actor) {
  if (!actor || actor.role !== 'clinician') return [];
  return actor.assignedPatientIds === null ? null : Array.isArray(actor.assignedPatientIds) ? [...actor.assignedPatientIds] : [];
}

export function assertStaffCapability(actor, capability, patientId = null) {
  if (!hasCapability(actor, capability)) throw new HttpError(403, '이 작업을 수행할 직무 권한이 없습니다. 담당 의료진에게 요청해 주세요.');
  const scope = assignedPatientIds(actor);
  if (patientId && scope !== null && !scope.includes(patientId)) throw new HttpError(403, '배정된 환자 범위에서만 작업할 수 있습니다.');
  return actor;
}
