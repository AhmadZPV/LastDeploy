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
import { hashPassword } from '../src/auth/password-guard.js';
import { POLICY, checkPassword, passwordErrors } from '../src/auth/policy.js';
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

  const back = (res, hash, err) =>
    res.redirect('/admin' + (err ? '?err=' + encodeURIComponent(err) : '') + (hash ? '#' + hash : ''));

  const notify = (req, type, key, params) => req.notify?.(type, key, params);

  // ------------------------------------------------------------- overview
  router.get('/', async (req, res) => {
    try {
      const [userRows, groupRows, memberRows, rightRows] = await Promise.all([
        users().findMany({ orderBy: { ID: 'asc' } }),
        groups().findMany({ orderBy: { GroupID: 'asc' } }),
        members().findMany(),
        rightsTbl().findMany(),
      ]);
      const invoiceRows = P().portalRechnungen
        ? await P().portalRechnungen.findMany({ orderBy: { EingereichtAm: 'desc' }, take: 100 })
        : [];
      const membersByGroup = {};
      for (const m of memberRows) {
        (membersByGroup[m.GroupID] = membersByGroup[m.GroupID] || []).push(m.UserName);
      }
      res.render('admin', {
        adminError: typeof req.query.err === 'string' ? req.query.err : null,
        users: userRows, groups: groupRows, members: memberRows,
        rights: rightRows, membersByGroup, invoices: invoiceRows,
        maskLetters: MASK_LETTERS, maskLabels: MASK_LABELS,
      });
    } catch (e) {
      res.status(500).send('Admin error: ' + e.message);
    }
  });

  router.get('/invoices/:id/file', async (req, res) => {
    const invoice = await P().portalRechnungen.findFirst({ where: { ID: Number(req.params.id) } });
    if (!invoice) return res.status(404).send('Invoice not found');
    res.setHeader('Content-Type', invoice.MimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(invoice.Dateiname)}`);
    res.send(Buffer.from(invoice.Datei));
  });

  router.post('/invoices/:id/status', async (req, res) => {
    const allowed = new Set(['pending', 'approved', 'rejected', 'needs_info']);
    const Status = String(req.body?.Status || '');
    if (!allowed.has(Status)) return res.status(400).send('Invalid invoice status');
    await P().portalRechnungen.update({
      where: { ID: Number(req.params.id) },
      data: {
        Status,
        Pruefnotiz: String(req.body?.Pruefnotiz || '').trim() || null,
        GeprueftAm: Status === 'pending' ? null : new Date(),
        GeprueftVon: Status === 'pending' ? null : req.session?.user?.Benutzername || null,
      },
    });
    res.redirect('/admin#invoices');
  });

  // ---------------------------------------------------------------- users
  router.post('/users', async (req, res) => {
    const { Benutzername, Passwort, Name, Email, active, Gruppe } = req.body || {};
    const login = String(Benutzername || '').trim();
    const pwd = String(Passwort || '');
    // Report the reason instead of redirecting silently: an empty catch here
    // made a duplicate username look like 'the button does nothing'.
    if (!login) return back(res, 'users', 'user_name_required');
    if (!pwd) return back(res, 'users', 'user_password_required');
    if (POLICY.pwdStrong && !checkPassword(pwd)) return back(res, 'users', 'user_password_weak');
    try {
      const dup = await users().findFirst({ where: { Benutzername: login } });
      if (dup) return back(res, 'users', 'user_exists');
      const max = await users().aggregate({ _max: { ID: true } });
      await users().create({
        data: {
          ID: (max?._max?.ID || 0) + 1,
          Benutzername: login,
          // never store an admin-created password in clear text
          Passwort: await hashPassword(pwd),
          Name: Name || '', Email: Email || '',
          active: active === undefined ? 1 : (active ? 1 : 0),
          Gruppe: Gruppe || null, Team: req.session?.user?.Team || 'Team',
        },
      });
      if (Gruppe) {
        const g = await groups().findFirst({ where: { Label: Gruppe } });
        // a missing group used to drop the membership without a word
        if (!g) return back(res, 'users', 'user_added_group_missing');
        await members().create({ data: { UserName: login, GroupID: g.GroupID } }).catch(() => {});
      }
    } catch (e) {
      return back(res, 'users', 'user_save_failed');
    }
    notify(req, 'success', 'user_added');
    back(res, 'users', 'user_added');
  });

  router.post('/users/:id/delete', async (req, res) => {
    try {
      const u = await users().findFirst({ where: { ID: +req.params.id } });
      await users().delete({ where: { ID: +req.params.id } });
      // keep membership rows from dangling
      if (u) await members().deleteMany({ where: { UserName: u.Benutzername } }).catch(() => {});
      notify(req, 'success', 'user_deleted');
    } catch {
      notify(req, 'error', 'user_delete_failed');
    }
    back(res, 'users');
  });

  /** Toggle the active flag rather than forcing a delete. */
  router.post('/users/:id/active', async (req, res) => {
    try {
      const u = await users().findFirst({ where: { ID: +req.params.id } });
      if (u) {
        const active = u.active ? 0 : 1;
        await users().update({ where: { ID: u.ID }, data: { active } });
        notify(req, 'success', active ? 'user_activated' : 'user_deactivated');
      }
    } catch {
      notify(req, 'error', 'user_save_failed');
    }
    back(res, 'users');
  });

  /** Admin-side password reset: no old password, but still hashed. */
  router.post('/users/:id/password', async (req, res) => {
    try {
      const pwd = String(req.body?.Passwort || '');
      if (!pwd) return back(res, 'users', 'user_password_required');
      if (POLICY.pwdStrong && !checkPassword(pwd)) return back(res, 'users', 'user_password_weak');
      await users().update({
        where: { ID: +req.params.id },
        data: { Passwort: await hashPassword(pwd), reset_token: null },
      });
    } catch {
      return back(res, 'users', 'user_save_failed');
    }
    notify(req, 'success', 'password_updated');
    back(res, 'users', 'password_updated');
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
