import { registry } from '../registry.js';

/**
 * Tenant filter appended to list/get queries.
 *
 * Session Team must always win over caller-supplied `extra.Team`. Spreading
 * `extra` last let a parent row with Team=null/undefined strip the tenant
 * filter (Prisma drops undefined keys), which leaked other teams' children.
 */
export function teamWhere(req, extra = {}, entity = null) {
  if (req?.session?.user?.isAdmin) return extra;
  const team = req?.session?.user?.Team;
  if (!team) return extra;
  if (entity) {
    const key = String(entity).toLowerCase();
    const meta = registry[key] || registry[entity];
    if (!meta || !meta.multiTenant) return extra;
  }
  return { ...extra, Team: team };
}

export default { teamWhere };
