/**
 * Phase 1 - administration area.
 *
 * Ports the PHP admin area: user list, group list, group membership and the
 * per-table rights matrix stored in `intex hausverwaltung_ugrights`.
 *
 * The router is factory-injected so it can be tested with a fake prisma.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { MASK_LETTERS, MASK_LABELS, FULL_MASK, normalizeMask, maskToMap }
  from '../src/auth/rights.js';
import { runAutoBookings } from '../src/jobs/autobuchungen.js';

export default function createAdminRouter(deps = {}) {
  const router = Router();
  // Fall back to the live client when no deps are injected (production wiring).
  const P = () => deps.prisma;
  const tables = () => (typeof deps.entityNames === 'function' ? deps.entityNames() : []);

  const users = () => P().benutzer || P().Benutzer;
  const groups = () => P().intex_hausverwaltung_uggroups;
  const members = () => P().intex_hausverwaltung_ugmembers;
  const rightsTbl = () => P().intex_hausverwaltung_ugrights;

  const back = (res, hash) => res.redirect('/admin' + (hash ? '#' + hash : ''));

  // ------------------------------------------------------------- overview
  router.get('/', async (req, res) => {
    try {
      const [userRows, groupRows, memberRows, rightRows] = await Promise.all([
        users().findMany({ orderBy: { ID: 'asc' } }),
        groups().findMany({ orderBy: { GroupID: 'asc' } }),
        members().findMany(),
        rightsTbl().findMany(),
      ]);
      const membersByGroup = {};
      for (const m of memberRows) {
        (membersByGroup[m.GroupID] = membersByGroup[m.GroupID] || []).push(m.UserName);
      }
      res.render('admin', {
        users: userRows, groups: groupRows, members: memberRows,
        rights: rightRows, membersByGroup,
        maskLetters: MASK_LETTERS, maskLabels: MASK_LABELS,
      });
    } catch (e) {
      res.status(500).send('Admin error: ' + e.message);
    }
  });

  // ---------------------------------------------------------------- users
  router.post('/users', async (req, res) => {
    try {
      const { Benutzername, Passwort, Name, Email, active, Gruppe } = req.body || {};
      if (!Benutzername || !Passwort) return back(res, 'users');
      const max = await users().aggregate({ _max: { ID: true } });
      await users().create({
        data: {
          ID: (max?._max?.ID || 0) + 1,
          Benutzername,
          // never store an admin-created password in clear text
          Passwort: await bcrypt.hash(String(Passwort), 10),
          Name: Name || '', Email: Email || '',
          active: active === undefined ? 1 : (active ? 1 : 0),
          Gruppe: Gruppe || null, Team: req.session?.user?.Team || 'Team',
        },
      });
      if (Gruppe) {
        const g = await groups().findFirst({ where: { Label: Gruppe } });
        if (g) await members().create({ data: { UserName: Benutzername, GroupID: g.GroupID } }).catch(() => {});
      }
    } catch {}
    back(res, 'users');
  });

  router.post('/users/:id/delete', async (req, res) => {
    try {
      const u = await users().findFirst({ where: { ID: +req.params.id } });
      await users().delete({ where: { ID: +req.params.id } });
      // keep membership rows from dangling
      if (u) await members().deleteMany({ where: { UserName: u.Benutzername } }).catch(() => {});
    } catch {}
    back(res, 'users');
  });

  /** Toggle the active flag rather than forcing a delete. */
  router.post('/users/:id/active', async (req, res) => {
    try {
      const u = await users().findFirst({ where: { ID: +req.params.id } });
      if (u) await users().update({ where: { ID: u.ID }, data: { active: u.active ? 0 : 1 } });
    } catch {}
    back(res, 'users');
  });

  /** Admin-side password reset: no old password, but still hashed. */
  router.post('/users/:id/password', async (req, res) => {
    try {
      const pwd = String(req.body?.Passwort || '');
      if (pwd) {
        await users().update({
          where: { ID: +req.params.id },
          data: { Passwort: await bcrypt.hash(pwd, 10), reset_token: null },
        });
      }
    } catch {}
    back(res, 'users');
  });

  // --------------------------------------------------------------- groups
  router.post('/groups', async (req, res) => {
    try {
      const Label = String(req.body?.Label || '').trim();
      if (Label) {
        const dup = await groups().findFirst({ where: { Label } });
        if (!dup) {
          const max = await groups().aggregate({ _max: { GroupID: true } });
          await groups().create({ data: { GroupID: (max?._max?.GroupID || 0) + 1, Label } });
        }
      }
    } catch {}
    back(res, 'groups');
  });

  router.post('/groups/:id/rename', async (req, res) => {
    try {
      const Label = String(req.body?.Label || '').trim();
      if (Label) await groups().update({ where: { GroupID: +req.params.id }, data: { Label } });
    } catch {}
    back(res, 'groups');
  });

  router.post('/groups/:id/delete', async (req, res) => {
    const id = +req.params.id;
    try {
      // remove the group's memberships and rights too, or they become orphans
      await members().deleteMany({ where: { GroupID: id } }).catch(() => {});
      await rightsTbl().deleteMany({ where: { GroupID: id } }).catch(() => {});
      await groups().delete({ where: { GroupID: id } });
    } catch {}
    back(res, 'groups');
  });

  // ----------------------------------------------------------- membership
  router.post('/members', async (req, res) => {
    try {
      const UserName = String(req.body?.UserName || '').trim();
      const GroupID = +req.body?.GroupID;
      if (UserName && GroupID) {
        const dup = await members().findFirst({ where: { UserName, GroupID } });
        if (!dup) await members().create({ data: { UserName, GroupID } });
      }
    } catch {}
    back(res, 'members');
  });

  router.post('/members/delete', async (req, res) => {
    try {
      const UserName = String(req.body?.UserName || '');
      const GroupID = +req.body?.GroupID;
      await members().delete({ where: { UserName_GroupID: { UserName, GroupID } } });
    } catch {}
    back(res, 'members');
  });

  // --------------------------------------------------------------- rights
  /** Rights matrix for one group: every known table x every mask letter. */
  router.get('/rights/:groupId', async (req, res) => {
    try {
      const GroupID = +req.params.groupId;
      const group = await groups().findFirst({ where: { GroupID } });
      if (!group) return res.status(404).send('Gruppe nicht gefunden');
      const rows = await rightsTbl().findMany({ where: { GroupID } });
      const byTable = Object.fromEntries(rows.map((r) => [r.TableName, r.AccessMask || '']));
      const names = tables();
      // include tables that only exist in the rights table (legacy rows)
      for (const r of rows) if (!names.includes(r.TableName)) names.push(r.TableName);
      const matrix = names.sort().map((t) => ({
        table: t, mask: byTable[t] || '', checked: maskToMap(byTable[t] || ''),
      }));
      res.render('admin-rights', {
        group, matrix, maskLetters: MASK_LETTERS, maskLabels: MASK_LABELS,
      });
    } catch (e) {
      res.status(500).send('Rights error: ' + e.message);
    }
  });

  /**
   * Save the whole matrix for a group. Body shape: rights[<Table>][<Letter>]=on
   * A table with no boxes ticked has its row removed rather than stored empty,
   * which is what the PHP admin does.
   */
  router.post('/rights/:groupId', async (req, res) => {
    const GroupID = +req.params.groupId;
    try {
      const posted = req.body?.rights || {};
      for (const [TableName, letters] of Object.entries(posted)) {
        const AccessMask = normalizeMask(letters);
        const existing = await rightsTbl().findFirst({ where: { TableName, GroupID } });
        if (!AccessMask) {
          if (existing) await rightsTbl().delete({ where: { TableName_GroupID: { TableName, GroupID } } });
        } else if (existing) {
          await rightsTbl().update({ where: { TableName_GroupID: { TableName, GroupID } }, data: { AccessMask } });
        } else {
          await rightsTbl().create({ data: { TableName, GroupID, AccessMask } });
        }
      }
    } catch (e) {
      return res.status(500).send('Rights error: ' + e.message);
    }
    res.redirect('/admin/rights/' + GroupID);
  });

  /** Grant full access on every known table - the usual bootstrap for Admins. */
  router.post('/rights/:groupId/grant-all', async (req, res) => {
    const GroupID = +req.params.groupId;
    try {
      for (const TableName of tables()) {
        const existing = await rightsTbl().findFirst({ where: { TableName, GroupID } });
        if (existing) {
          await rightsTbl().update({
            where: { TableName_GroupID: { TableName, GroupID } }, data: { AccessMask: FULL_MASK },
          });
        } else {
          await rightsTbl().create({ data: { TableName, GroupID, AccessMask: FULL_MASK } });
        }
      }
    } catch {}
    res.redirect('/admin/rights/' + GroupID);
  });

  // -------------------------------------------------------- auto bookings
  router.post('/auto-bookings', async (req, res) => {
    try {
      const created = await runAutoBookings(P());
      res.redirect('/kontobuch?autobooked=' + created);
    } catch (e) {
      res.status(500).send('Autobuchungen error: ' + e.message);
    }
  });

  return router;
}

/**
 * Port of the MySQL EVENT `Autobuchungen`.
 *
 * The original is a single INSERT ... SELECT using CURDATE() and the MySQL
 * `@Team :=` user variable, neither of which exists in SQLite. We therefore
 * read the recurring rows and insert them one by one, allocating the next
 * Belegnummer per Team exactly like the event did.
 */
export { runAutoBookings } from '../src/jobs/autobuchungen.js';
