import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { hashPassword } from '../src/auth/password-guard.js';
import { POLICY, checkPassword } from '../src/auth/policy.js';
import { loginWhere } from '../src/auth/login-lookup.js';
import { loginAllowed, recordLoginFailure, recordLoginSuccess } from '../src/auth/login-throttle.js';
import { normalizeLang, langFromRequest, createTranslator } from '../src/i18n.js';
import { contentTypeByExtension, sanitizeFileName } from '../src/uploads.js';

/**
 * Customer Portal (Kundenportal)
 *
 * A lightweight public-facing area separate from the admin panel. Customers
 * can register, log in, submit meter readings, contact the management, and
 * view announcements — all without admin access.
 *
 * Users created through the portal get Art = "portal" so the main menu
 * system can distinguish them from staff users.
 */

const PORTAL_ART = 'portal';
const PORTAL_GROUP = 'Portal';
const MITTEILUNGEN_POSTKORB = 'Mitteilungen';
const INVOICE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const INVOICE_MAX_SIZE = 10 * 1024 * 1024;

export default function createPortalRouter(deps = {}) {
  const router = Router();
  const P = () => deps.prisma;
  const back = (res, path) => res.redirect('/portal/' + (path || ''));

  /** Middleware: only allow portal users (Art=portal). Staff get redirected to admin. */
  const requirePortalUser = (req, res, next) => {
    const u = req.session?.user;
    if (!u) return res.redirect('/portal/login');
    if (u.Art !== PORTAL_ART) return res.redirect('/');
    next();
  };

  /** Middleware: set up i18n translator for portal views. */
  router.use((req, res, next) => {
    const lang = normalizeLang(req.session?.lang || langFromRequest(req));
    const i18n = createTranslator(lang);
    res.locals.portalUser = (req.session?.user?.Art === PORTAL_ART) ? req.session.user : null;
    res.locals.portalLang = lang;
    res.locals.t = i18n.t;
    res.locals.tx = i18n.tx;
    res.locals.txContent = i18n.txContent;
    res.locals.lang = lang;
    next();
  });

  // --------------------------------------------------------------- landing
  router.get('/', (req, res) => {
    res.render('portal/landing', { title: res.locals.t('portal_name') });
  });

  // --------------------------------------------------------------- register
  router.get('/anmeldung', (req, res) => {
    res.render('portal/anmeldung', { title: 'Registrierung', error: null, values: {} });
  });

  router.post('/anmeldung', async (req, res) => {
    const b = req.body || {};
    const Benutzername = String(b.Benutzername || '').trim();
    const Passwort = String(b.Passwort || '');
    const Name = String(b.Name || '').trim();
    const Email = String(b.Email || '').trim();
    const Firma = String(b.Firma || '').trim();
    const Vorname = String(b.Vorname || '').trim();
    const Nachname = String(b.Nachname || '').trim();
    const Strasse = String(b.Strasse || '').trim();
    const PLZ = String(b.PLZ || '').trim();
    const Ort = String(b.Ort || '').trim();
    const Telefon = String(b.Telefon || '').trim();

    if (!Benutzername || !Passwort || !Name || !Email) {
      return res.render('portal/anmeldung', { title: res.locals.t('portal_registration'), error: res.locals.t('portal_fill_required'), values: b });
    }
    if (POLICY.pwdStrong && !checkPassword(Passwort)) {
      return res.render('portal/anmeldung', { title: res.locals.t('portal_registration'), error: res.locals.t('user_password_weak'), values: b });
    }

    try {
      const prisma = P();
      const dup = await prisma.benutzer.findFirst({ where: { Benutzername } });
      if (dup) {
        return res.render('portal/anmeldung', { title: res.locals.t('portal_registration'), error: res.locals.t('user_exists'), values: b });
      }

      // Create the address record
      const addrMax = await prisma.adressen.aggregate({ _max: { ID: true } });
      const addrId = (addrMax?._max?.ID || 0) + 1;
      await prisma.adressen.create({
        data: {
          ID: addrId,
          Kurzname: Name,
          Firma: Firma || null,
          Vorname: Vorname || null,
          Nachname: Nachname || null,
          Strasse: Strasse || null,
          PLZ: PLZ || null,
          Ort: Ort || null,
          Telefon: Telefon || null,
          Email: Email,
          Klassifikation: 'Kunde',
          Team: 'Team',
        },
      });

      // Create the user with Art=portal
      const userMax = await prisma.benutzer.aggregate({ _max: { ID: true } });
      await prisma.benutzer.create({
        data: {
          ID: (userMax?._max?.ID || 0) + 1,
          Benutzername,
          Passwort: await hashPassword(Passwort),
          Name,
          Email,
          Gruppe: PORTAL_GROUP,
          Art: PORTAL_ART,
          Team: 'Team',
          active: 1,
        },
      });

      res.render('portal/anmeldung', { title: res.locals.t('portal_registration'), error: null, values: {}, success: true });
    } catch (e) {
      res.render('portal/anmeldung', { title: res.locals.t('portal_registration'), error: res.locals.t('portal_error_occurred', { msg: e.message }), values: b });
    }
  });

  // --------------------------------------------------------------- login
  router.get('/login', (req, res) => {
    res.render('portal/login', { title: res.locals.t('login_title'), error: null });
  });

  router.post('/login', async (req, res) => {
    const where = loginWhere(req.body || {});
    const Passwort = req.body?.Passwort ?? req.body?.password;
    const ip = req.ip || '';
    const t = res.locals.t;

    if (where && !loginAllowed(where.Benutzername, ip)) {
      return res.status(429).render('portal/login', { title: t('login_title'), error: t('portal_login_blocked') });
    }

    try {
      const user = where ? await P().benutzer.findFirst({ where }) : null;
      let ok = false;
      if (user) {
        try {
          ok = (user.Passwort === Passwort) || (user.Passwort?.startsWith('$2') && await bcrypt.compare(Passwort, user.Passwort));
        } catch {}
      }

      if (!user || !ok) {
        recordLoginFailure(where?.Benutzername || '', ip);
        return res.render('portal/login', { title: t('login_title'), error: t('portal_login_error') });
      }

      // Only portal users can use the portal login
      if (user.Art !== PORTAL_ART) {
        return res.render('portal/login', { title: t('login_title'), error: t('portal_staff_login') });
      }

      recordLoginSuccess(user.Benutzername, ip);

      // Upgrade plaintext password to bcrypt
      if (!user.Passwort?.startsWith('$2')) {
        const hash = await bcrypt.hash(Passwort, 10);
        await P().benutzer.update({ where: { ID: user.ID }, data: { Passwort: hash } }).catch(() => {});
      }

      const keepLang = normalizeLang(req.session?.lang || langFromRequest(req));
      req.session.regenerate((err) => {
        if (err) return res.status(500).render('portal/login', { title: t('login_title'), error: t('portal_session_error') });
        req.session.lang = keepLang;
        req.session.user = {
          ID: user.ID,
          Benutzername: user.Benutzername,
          Name: user.Name,
          Gruppe: user.Gruppe,
          Team: user.Team || 'Team',
          Art: PORTAL_ART,
        };
        res.redirect('/portal/dashboard');
      });
    } catch (e) {
      res.render('portal/login', { title: 'Anmeldung', error: 'Ein Fehler ist aufgetreten.' });
    }
  });

  router.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/portal')));

  // --------------------------------------------------------------- dashboard
  router.get('/dashboard', requirePortalUser, async (req, res) => {
    try {
      const prisma = P();
      const team = req.session.user.Team;
      const [objekte, einheiten, mitteilungen, zaehler] = await Promise.all([
        prisma.objekte.count({ where: { Team: team } }),
        prisma.einheiten.count({ where: { Team: team } }),
        prisma.korrespondenz.count({ where: { Postkorb: MITTEILUNGEN_POSTKORB, Team: team } }),
        prisma.zaehler.count({ where: { Team: team } }),
      ]);
      const recentMitteilungen = await prisma.korrespondenz.findMany({
        where: { Postkorb: MITTEILUNGEN_POSTKORB, Team: team },
        orderBy: { Datum: 'desc' },
        take: 5,
      });
      res.render('portal/dashboard', { title: res.locals.t('portal_overview'), objekte, einheiten, mitteilungen, zaehler, recentMitteilungen });
    } catch (e) {
      res.status(500).send('Portal error: ' + e.message);
    }
  });

  // --------------------------------------------------------------- kontakt
  router.get('/kontakt', requirePortalUser, (req, res) => {
    res.render('portal/kontakt', { title: res.locals.t('portal_contact_heading'), error: null, success: false });
  });

  router.post('/kontakt', requirePortalUser, async (req, res) => {
    const b = req.body || {};
    const Betreff = String(b.Betreff || '').trim();
    const Text = String(b.Text || '').trim();
    if (!Betreff || !Text) {
      return res.render('portal/kontakt', { title: res.locals.t('portal_contact_heading'), error: res.locals.t('portal_fill_subject_text'), success: false });
    }
    try {
      const prisma = P();
      const maxId = await prisma.korrespondenz.aggregate({ _max: { ID: true } });
      await prisma.korrespondenz.create({
        data: {
          ID: (maxId?._max?.ID || 0) + 1,
          Betreff,
          Text,
          Datum: new Date(),
          Art: 'E-Mail',
          Postkorb: 'Posteingang',
          Benutzer: req.session.user.Benutzername,
          Team: req.session.user.Team,
          Absendermail: req.session.user.Email || null,
          Absendedatum: new Date().toISOString().slice(0, 10),
        },
      });
      res.render('portal/kontakt', { title: res.locals.t('portal_contact_heading'), error: null, success: true });
    } catch (e) {
      res.render('portal/kontakt', { title: res.locals.t('portal_contact_heading'), error: res.locals.t('portal_error_occurred', { msg: e.message }), success: false });
    }
  });

  // --------------------------------------------------------------- invoices
  router.get('/rechnungen', requirePortalUser, async (req, res) => {
    const where = { Benutzer: req.session.user.Benutzername, Team: req.session.user.Team };
    const rechnungen = await P().portalRechnungen.findMany({ where, orderBy: { EingereichtAm: 'desc' } });
    res.render('portal/rechnungen', { title: res.locals.t('portal_invoices'), rechnungen, error: null, success: req.query.sent === '1' });
  });

  router.post('/rechnungen', requirePortalUser, async (req, res) => {
    const t = res.locals.t;
    const file = (req.files || []).find((entry) => entry.fieldname === 'invoice');
    const Rechnungsnummer = String(req.body?.Rechnungsnummer || '').trim();
    const Betrag = Number(String(req.body?.Betrag || '').replace(',', '.'));
    const name = sanitizeFileName(file?.originalname);
    const mime = file ? contentTypeByExtension(name) : '';
    const invalid = !Rechnungsnummer || !Number.isFinite(Betrag) || Betrag <= 0 || !file;
    const invalidFile = file && (!INVOICE_TYPES.has(mime) || file.size > INVOICE_MAX_SIZE);
    if (invalid || invalidFile) {
      const where = { Benutzer: req.session.user.Benutzername, Team: req.session.user.Team };
      const rechnungen = await P().portalRechnungen.findMany({ where, orderBy: { EingereichtAm: 'desc' } });
      return res.status(400).render('portal/rechnungen', {
        title: t('portal_invoices'), rechnungen, success: false,
        error: invalidFile ? t('portal_invoice_file_invalid') : t('portal_invoice_required'),
      });
    }
    await P().portalRechnungen.create({
      data: {
        Benutzer: req.session.user.Benutzername,
        Team: req.session.user.Team,
        Rechnungsnummer,
        Rechnungsdatum: req.body.Rechnungsdatum ? new Date(req.body.Rechnungsdatum) : null,
        Betrag,
        Objekt: req.body.Objekt ? Number(req.body.Objekt) : null,
        Einheit: req.body.Einheit ? Number(req.body.Einheit) : null,
        Beschreibung: String(req.body.Beschreibung || '').trim() || null,
        Dateiname: name,
        MimeType: mime,
        Datei: Buffer.from(file.buffer),
      },
    });
    res.redirect('/portal/rechnungen?sent=1');
  });

  router.get('/rechnungen/:id/datei', requirePortalUser, async (req, res) => {
    const invoice = await P().portalRechnungen.findFirst({
      where: { ID: Number(req.params.id), Benutzer: req.session.user.Benutzername, Team: req.session.user.Team },
    });
    if (!invoice) return res.status(404).send(res.locals.t('not_found'));
    res.setHeader('Content-Type', invoice.MimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(invoice.Dateiname)}`);
    res.send(Buffer.from(invoice.Datei));
  });

  // --------------------------------------------------------------- meter reading
  router.get('/meldungen', requirePortalUser, async (req, res) => {
    try {
      const prisma = P();
      const team = req.session.user.Team;
      const zaehler = await prisma.zaehler.findMany({
        where: { Team: team },
        orderBy: { Ablesedatum: 'desc' },
        take: 20,
        include: { rel_Raeume_Raum: { include: { rel_Einheiten_Einheit: true } } },
      });
      res.render('portal/meldungen', { title: res.locals.t('portal_meter_readings'), zaehler, error: null, success: false });
    } catch (e) {
      res.render('portal/meldungen', { title: res.locals.t('portal_meter_readings'), zaehler: [], error: res.locals.t('portal_error_occurred', { msg: e.message }), success: false });
    }
  });

  router.post('/meldungen', requirePortalUser, async (req, res) => {
    const b = req.body || {};
    const Zaehlerart = String(b.Zaehlerart || '').trim();
    const Zaehlernummer = String(b.Zaehlernummer || '').trim();
    const Zaehlerstand = String(b.Zaehlerstand || '').trim();
    const Ablesedatum = b.Ablesedatum ? new Date(b.Ablesedatum) : new Date();

    if (!Zaehlerart || !Zaehlernummer || !Zaehlerstand) {
      const prisma = P();
      const zaehler = await prisma.zaehler.findMany({ where: { Team: req.session.user.Team }, orderBy: { Ablesedatum: 'desc' }, take: 20 });
      return res.render('portal/meldungen', { title: res.locals.t('portal_meter_readings'), zaehler, error: res.locals.t('portal_fill_required'), success: false });
    }
    try {
      const prisma = P();
      const maxId = await prisma.zaehler.aggregate({ _max: { ID: true } });
      await prisma.zaehler.create({
        data: {
          ID: (maxId?._max?.ID || 0) + 1,
          Zaehlerart,
          Zaehlernummer,
          Zaehlerstand,
          Ablesedatum,
          Team: req.session.user.Team,
        },
      });
      const zaehler = await prisma.zaehler.findMany({ where: { Team: req.session.user.Team }, orderBy: { Ablesedatum: 'desc' }, take: 20 });
      res.render('portal/meldungen', { title: res.locals.t('portal_meter_readings'), zaehler, error: null, success: true });
    } catch (e) {
      const prisma = P();
      const zaehler = await prisma.zaehler.findMany({ where: { Team: req.session.user.Team }, orderBy: { Ablesedatum: 'desc' }, take: 20 });
      res.render('portal/meldungen', { title: res.locals.t('portal_meter_readings'), zaehler, error: res.locals.t('portal_error_occurred', { msg: e.message }), success: false });
    }
  });

  // --------------------------------------------------------------- mitteilungen
  router.get('/mitteilungen', requirePortalUser, async (req, res) => {
    try {
      const prisma = P();
      const team = req.session.user.Team;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const perPage = 10;
      const where = { Postkorb: MITTEILUNGEN_POSTKORB, Team: team };
      const total = await prisma.korrespondenz.count({ where });
      const pages = Math.max(1, Math.ceil(total / perPage));
      const items = await prisma.korrespondenz.findMany({
        where,
        orderBy: { Datum: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      });
      res.render('portal/mitteilungen', { title: res.locals.t('portal_announcements'), items, page, pages, total });
    } catch (e) {
      res.status(500).send('Portal error: ' + e.message);
    }
  });

  // --------------------------------------------------------------- properties (read-only)
  router.get('/objekte', requirePortalUser, async (req, res) => {
    try {
      const prisma = P();
      const team = req.session.user.Team;
      const objekte = await prisma.objekte.findMany({
        where: { Team: team },
        orderBy: { Bezeichnung: 'asc' },
      });
      res.render('portal/objekte', { title: res.locals.t('portal_properties'), objekte });
    } catch (e) {
      res.status(500).send('Portal error: ' + e.message);
    }
  });

  router.get('/einheiten', requirePortalUser, async (req, res) => {
    try {
      const prisma = P();
      const team = req.session.user.Team;
      const einheiten = await prisma.einheiten.findMany({
        where: { Team: team },
        orderBy: { Bezeichnung: 'asc' },
        include: { rel_Objekte_Objekt: true },
      });
      res.render('portal/einheiten', { title: res.locals.t('portal_units'), einheiten });
    } catch (e) {
      res.status(500).send('Portal error: ' + e.message);
    }
  });

  return router;
}
