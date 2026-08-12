import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { loadMenu, menuFor } from './src/menu.js';
import { dashboardFor } from './src/dashboards.js';
import { registry, moduleNames } from './src/registry.js';
import createCrudRouter from './routes/crud.js';
import createAdminRouter from './routes/admin.js';
import createAjaxRouter from './routes/ajax.js';
import createDashboardRouter, { buildDashboardView } from './routes/dashboard.js';
import fileRouter from './routes/files.js';
import createUploadRouter from './routes/uploads.js';
import createExportRouter from './routes/exports.js';
import createPrintRouter from './routes/print.js';
import createReportRouter from './routes/reports.js';
import createMediaRouter from './routes/media.js';
import createButtonHandlerRouter from './routes/buttonhandler.js';
import createChartRouter from './routes/charts.js';
import createSettingsRouter from './routes/settings.js';
import createSearchesRouter from './routes/searches.js';
import createAuthRouter from './routes/auth.js';
import createImportRouter from './routes/imports.js';
import { csrfProtection, csrfToken } from './src/csrf.js';
import { startAutoBookings } from './src/jobs/autobuchungen.js';
import createWebhookRouter from './routes/webhooks.js';
import { createVariantRouter } from './routes/variants.js';
import createSpecialExportRouter from './routes/special-exports.js';
import createVirtualRouter from './routes/virtual.js';
import createGeocodingRouter from './routes/geocoding.js';
import { multipartParser } from './src/multipart.js';
import { FileSessionStore } from './src/session-store.js';
import { createTranslator, langFromRequest, normalizeLang, SUPPORTED } from './src/i18n.js';
import { slugify as dashSlugify } from './src/dashboards.js';
import { normalizeSqliteDateTimes } from './src/sqlite-dates.js';
import { loginWhere } from './src/auth/login-lookup.js';
import { teamWhere as scopedTeamWhere } from './src/auth/team-scope.js';
import { loginAllowed, recordLoginFailure, recordLoginSuccess } from './src/auth/login-throttle.js';
import { sessionSecret } from './src/auth/session-secret.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const prisma = new PrismaClient();
export const app = express();
const secureCookie = process.env.SESSION_COOKIE_SECURE == null
  ? process.env.NODE_ENV === 'production'
  : process.env.SESSION_COOKIE_SECURE === 'true';

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(multipartParser());
app.use('/static', express.static(path.join(__dirname, 'public')));
for (const file of ['manifest.json', 'sw.js', 'offline.html', 'icon-192.png', 'icon-512.png']) {
  app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
}
app.use(session({
  secret: sessionSecret(),
  store: new FileSessionStore({ dir: process.env.SESSION_DIR || path.join(__dirname, 'data', 'sessions') }),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookie,
  }
}));

const safe = (p, fallback) => typeof p?.catch === 'function' ? p.catch(() => fallback) : (p || fallback);
const toNum = (d) => d == null ? 0 : (typeof d === 'object' && 'toNumber' in d ? d.toNumber() : Number(d));

/** All lookup keys for one PHPRunner TableName (slug, spaced, lowercased). */
function rightsKeysForTable(tableName) {
  const raw = String(tableName || '').trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  const slug = dashSlugify(raw);
  const underscored = lower.replace(/\s+/g, '_');
  return [...new Set([lower, slug, underscored, raw])];
}

function mergeMask(a, b) {
  const s = new Set([...(a || '').toUpperCase(), ...(b || '').toUpperCase()]);
  return [...s].join('');
}

// Load user rights into a Map with multiple key forms per table so menu slugs
// (assistent_abrechnungen) and TableName keys (assistent abrechnungen) both hit.
async function loadRights(prisma, username, group) {
  const rights = {};
  const groupIds = new Set();
  let isAdmin = false;

  const ADMIN_LABELS = new Set(['admins', 'admin', 'administrator', 'superuser']);
  if (group && ADMIN_LABELS.has(String(group).toLowerCase())) isAdmin = true;

  try {
    const members = await prisma.intex_hausverwaltung_ugmembers.findMany({
      where: { UserName: username },
    });
    for (const m of members || []) {
      if (m.GroupID != null) groupIds.add(m.GroupID);
      // PHPRunner stores full admin rights under GroupID -1
      if (m.GroupID === -1 || m.GroupID === '-1') isAdmin = true;
    }
  } catch { /* table may be missing in slim fixtures */ }

  if (group) {
    try {
      const g = await prisma.intex_hausverwaltung_uggroups.findFirst({ where: { Label: group } });
      if (g && g.GroupID != null) groupIds.add(g.GroupID);
    } catch {}
  }

  // Also load the classic admin rights pack when GroupID -1 exists
  if (isAdmin) groupIds.add(-1);

  for (const gid of groupIds) {
    try {
      const rows = await prisma.intex_hausverwaltung_ugrights.findMany({ where: { GroupID: gid } });
      for (const r of rows || []) {
        const mask = r.AccessMask || '';
        for (const key of rightsKeysForTable(r.TableName)) {
          rights[key] = mergeMask(rights[key], mask);
        }
      }
    } catch {}
  }

  return { rights, isAdmin };
}

// Populates session on first authenticated request: Team, rights, Währung/etc from Einstellungen.
async function populateSession(req) {
  if (!req.session.user || req.session.user._populated) return;
  const u = req.session.user;
  if (!u.Team) {
    const dbUser = await prisma.benutzer.findUnique({ where: { ID: u.ID } }).catch(() => null);
    u.Team = dbUser?.Team || 'Team';
  }
  const loaded = await loadRights(prisma, u.Benutzername, u.Gruppe);
  u.rights = loaded.rights;
  u.isAdmin = loaded.isAdmin === true
    || u.Gruppe === 'Admins'
    || String(u.Gruppe || '').toLowerCase() === 'admin';
  try {
    const einst = await prisma.einstellungen.findFirst({ where: { Team: u.Team } });
    if (einst) {
      u.Waehrung = einst.Waehrung || 'EUR';
      u.layoutSSMTP = einst.SMTPServer || null;
    }
  } catch {}
  u._populated = true;
}

app.use(async (req, res, next) => {
  if (req.session?.user) await populateSession(req);
  const i18n = createTranslator(langFromRequest(req));
  req.notify = (type, key, params = {}) => {
    if (req.session) req.session.notification = { type, key, params };
  };
  res.locals.notification = req.session?.notification || null;
  if (req.session?.notification) delete req.session.notification;
  res.locals.lang = i18n.lang;
  res.locals.t = i18n.t;
  res.locals.tx = i18n.tx;
  res.locals.user = req.session?.user || null;
  res.locals.path = req.path;
  const rawMenu = menuFor({
    isAdmin: req.session?.user?.isAdmin === true,
    isGuest: !req.session?.user,
    canAccess: (slug, letters = 'S') => canAccess(req, slug, letters),
  });
  const translatedGroups = (rawMenu.groups || []).map((g) => ({
    ...g,
    label: i18n.tx(g.label),
    parentLabel: i18n.tx(g.parentLabel),
    items: (g.items || []).map((it) => ({
      ...it,
      label: i18n.tx(it.label),
      title: i18n.tx(it.title),
    })),
  }));
  const translatedById = new Map(translatedGroups.map((group) => [group.id, group]));
  // Translate menu labels when English is active
  res.locals.menu = {
    ...rawMenu,
    groups: translatedGroups,
    sections: (rawMenu.sections || []).map((section) => ({
      ...section,
      label: i18n.tx(section.label),
      groups: section.groups.map((group) => translatedById.get(group.id) || group),
    })),
  };
  res.locals.modules = registry;
  req.app.locals.registry = registry;
  res.locals.moduleNames = moduleNames();
  res.locals.waehrung = req.session?.user?.Waehrung || 'EUR';
  res.locals.csrfToken = csrfToken(req);
  next();
});
app.use(csrfProtection);

// Language toggle (no auth required); session + cookie so login regenerate keeps it
app.get('/lang/:code', (req, res) => {
  const code = normalizeLang(req.params.code);
  if (req.session) req.session.lang = code;
  res.cookie('lang', code, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'lax' });
  const back = req.get('Referer') || req.query.next || '/';
  try {
    const u = new URL(back, 'http://localhost');
    if (u.pathname.startsWith('/')) return res.redirect(u.pathname + u.search);
  } catch { /* fall through */ }
  res.redirect('/');
});

export const requireAuth = (req, res, next) => {
  if (!req.session?.user) return res.redirect('/login');
  next();
};

// AccessMask helper. letter in {A,E,D,S,P,M,I}
// 'A' add, 'E' edit, 'D' delete, 'S' search/list, 'P' print, 'M' map, 'I' import
export const requireAccess = (letter) => (req, res, next) => {
  const u = req.session?.user;
  if (!u) return res.redirect('/login');
  if (u.isAdmin) return next();
  const entity = (req.params.entity || req.baseUrl.slice(1) || '').toLowerCase();
  const mask = (u.rights?.[entity] || '').toUpperCase();
  if (!mask) return res.status(403).render('error', { message: 'Keine Berechtigung für ' + entity });
  if (![...letter.toUpperCase()].every((l) => mask.includes(l))) {
    return res.status(403).render('error', { message: 'Keine ' + letter + '-Berechtigung für ' + entity });
  }
  next();
};

// Programmatic access check used by AJAX/file routes that already produce JSON.
// Supports a JSON 403 response instead of the HTML error page.
export function canAccess(req, entity, letters = 'S') {
  const u = req.session?.user;
  if (!u) return false;
  if (u.isAdmin) return true;
  const rights = u.rights || {};
  const candidates = [
    String(entity || '').toLowerCase(),
    dashSlugify(entity),
    String(entity || '').toLowerCase().replace(/\s+/g, '_'),
    String(entity || ''),
  ];
  let mask = '';
  for (const key of candidates) {
    if (key && rights[key]) {
      mask = rights[key];
      break;
    }
  }
  mask = (mask || '').toUpperCase();
  if (!mask) return false;
  return [...letters.toUpperCase()].every((L) => mask.includes(L));
}

// Admin-only gate for the admin area. Mirrors PHPRunner's ACCESS_LEVEL_ADMIN.
export const requireAdmin = (req, res, next) => {
  const u = req.session?.user;
  if (!u) return res.redirect('/login');
  if (u.isAdmin) return next();
  return res.status(403).render('error', { message: 'Keine Admin-Berechtigung' });
};

// Team scoped where helper (appended to every list query). Only adds Team if the model has it.
export function teamWhere(req, extra = {}, entity = null) {
  return scopedTeamWhere(req, extra, entity);
}

app.get('/', requireAuth, async (req, res) => {
  try {
    const counts = {
      objekte: await safe(prisma.objekte.count({ where: teamWhere(req, {}, 'objekte') }), 0),
      einheiten: await safe(prisma.einheiten.count({ where: teamWhere(req, {}, 'einheiten') }), 0),
      adressen: await safe(prisma.adressen.count({ where: teamWhere(req, {}, 'adressen') }), 0),
      abrechnungen: await safe(prisma.abrechnungen.count({ where: teamWhere(req, {}, 'abrechnungen') }), 0),
      aufgaben: await safe(prisma.aufgaben.count({ where: { ...teamWhere(req, {}, 'aufgaben'), Bearbeitungstatus: { not: 'Erledigt' } } }), 0),
      kontobuch: await safe(prisma.kontobuch.count({ where: teamWhere(req, {}, 'kontobuch') }), 0),
      termine: await safe(prisma.termine.count({ where: { ...teamWhere(req, {}, 'termine'), Datum: { gte: new Date(new Date().setHours(0,0,0,0)) } } }), 0)
    };
    const mieteAgg = await safe(prisma.einheiten.aggregate({ _sum: { Kaltmiete: true }, where: teamWhere(req, {}, 'einheiten') }), { _sum: { Kaltmiete: null } });
    const mieteTotal = toNum(mieteAgg._sum.Kaltmiete);
    let userAufgaben = [];
    if (req.session.user) {
      userAufgaben = await safe(prisma.aufgaben.findMany({
        where: { ...teamWhere(req, {}, 'aufgaben'), Benutzer: req.session.user.Benutzername, Bearbeitungstatus: { not: 'Erledigt' } },
        orderBy: { Datum: 'asc' }, take: 10
      }), []);
    }
    const dash = await safe(
      buildDashboardView({ prisma, req, teamWhere, canAccess, dashboard: dashboardFor('Heute') }),
      null
    );
    res.render('dashboard', { counts, mieteTotal, userAufgaben, dash });
  } catch (e) {
    res.status(500).send('Dashboard error: ' + e.message);
  }
});

app.get('/login', (req, res) => res.render('login', { error: null }));
app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'ready' });
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' });
  }
});
app.post('/login', async (req, res) => {
  const where = loginWhere(req.body || {});
  const Passwort = req.body.Passwort ?? req.body.password;
  const ip = req.ip || req.socket?.remoteAddress || '';
  const t = res.locals.t || ((k) => k);
  if (where && !loginAllowed(where.Benutzername, ip)) {
    return res.status(429).render('login', { error: t('login_throttled') });
  }
  const user = where ? await safe(prisma.benutzer.findFirst({ where }), null) : null;
  let ok = false;
  if (user) {
    try { ok = (user.Passwort === Passwort) || (user.Passwort?.startsWith('$2') && await bcrypt.compare(Passwort, user.Passwort)); } catch {}
  }
  if (!user || !ok) {
    recordLoginFailure(where?.Benutzername || '', ip);
    return res.render('login', { error: t('login_error') });
  }
  recordLoginSuccess(user.Benutzername, ip);
  if (!user.Passwort?.startsWith('$2')) {
    const hash = await bcrypt.hash(Passwort, 10);
    await prisma.benutzer.update({ where: { ID: user.ID }, data: { Passwort: hash } }).catch(() => {});
  }
  const keepLang = normalizeLang(req.session?.lang || langFromRequest(req));
  req.session.regenerate((err) => {
    if (err) {
      const t = res.locals.t || ((k) => k);
      return res.status(500).render('login', { error: t('session_error') });
    }
    req.session.lang = keepLang;
    req.session.user = {
      ID: user.ID, Benutzername: user.Benutzername, Name: user.Name,
      Gruppe: user.Gruppe, Team: user.Team || 'Team',
    };
    req.notify('success', 'welcome', { name: user.Name || user.Benutzername });
    res.redirect('/');
  });
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// Generic CRUD for every entity in the registry (mounted only if its Prisma delegate exists).
for (const name of moduleNames()) {
  const meta = registry[name];
  if (!meta?.model || !prisma[meta.model]) continue;
  app.use('/' + name, requireAuth, createCrudRouter(name, meta));
}

app.use('/ajax', requireAuth, createAjaxRouter());
app.use('/file', requireAuth, fileRouter({ prisma, canAccess, teamWhere }));
app.use('/', createAuthRouter({ prisma }));
app.use('/upload', requireAuth, createUploadRouter({ prisma, canAccess, teamWhere }));
app.use('/import', requireAuth, createImportRouter({ prisma, canAccess, teamWhere }));
app.use('/webhook', requireAuth, createWebhookRouter({ prisma, canAccess, teamWhere }));
app.use('/', requireAuth, createVariantRouter({ prisma, canAccess, teamWhere }));

// Phase 4/5 engines: one metadata-driven route each, standing in for the
// 85 *_export.php, 80 *_print.php and 36 *_report.php pages of the original.
const engineDeps = { prisma, canAccess, teamWhere };
app.use('/export', requireAuth, createSpecialExportRouter(engineDeps));
app.use('/special/export', requireAuth, createSpecialExportRouter(engineDeps));
app.use('/export', requireAuth, createExportRouter(engineDeps));
app.use('/print', requireAuth, createPrintRouter(engineDeps));
app.use('/report', requireAuth, createReportRouter(engineDeps));
app.use('/media', requireAuth, createMediaRouter(engineDeps));
app.use('/buttonhandler', requireAuth, createButtonHandlerRouter(engineDeps));
app.use('/chart', requireAuth, createChartRouter(engineDeps));
// Phase 10: dedicated settings page + persistent saved searches
app.use('/settings', requireAuth, createSettingsRouter(engineDeps));
app.use('/savedsearches', requireAuth, createSearchesRouter(engineDeps));
app.use('/dashboard', requireAuth, createDashboardRouter({ prisma, canAccess, teamWhere }));
app.use('/virtual', requireAuth, createVirtualRouter({ prisma, canAccess, teamWhere }));
app.use('/geocode', requireAuth, createGeocodingRouter({ prisma, canAccess, teamWhere }));
app.use('/admin', requireAuth, requireAdmin, createAdminRouter({ prisma, entityNames: moduleNames }));

app.get(['/admin_rights', '/admin_rights/edit', '/admin_rights//edit'], requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin#groups');
});

app.get('/backup', requireAuth, requireAdmin, (req, res) => {
  res.render('backup', { databasePath: process.env.DATABASE_URL || 'file:./dev.db' });
});

// Menu list pages keep their original PHPRunner paths (for example
// /kontoauszuege2), even when they are metadata-backed views rather than
// Prisma models. Mount this fallback last so concrete application routes win.
app.use('/', requireAuth, createVirtualRouter({ prisma, canAccess, teamWhere }));

const PORT = process.env.PORT || 3000;
const normalizedDates = await normalizeSqliteDateTimes(prisma);
if (normalizedDates) console.log(`Normalized ${normalizedDates} SQLite date values`);
const server = app.listen(PORT, () => {
  console.log('Ap Emlaki (SQLite) running on http://localhost:' + PORT);
  startAutoBookings({ prisma });
});

export { server };
