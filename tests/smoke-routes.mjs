/**
 * Route-level smoke harness.
 *
 * Mounts every router the server mounts, walks each registered GET route and
 * invokes the handler in-process with a fake req/res. res.render really
 * compiles and executes the EJS template, so template errors, undefined
 * locals and broken includes surface as failures.
 *
 * Runs the whole sweep once per language so translation regressions show up.
 *
 *   node tests/smoke-routes.mjs            # summary
 *   node tests/smoke-routes.mjs --verbose  # list every route
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const VIEWS = path.join(ROOT, 'views')
const VERBOSE = process.argv.includes('--verbose')
const LANGS = ['de', 'en']

const failures = []
const results = []

function note(lang, group, method, route, status, detail) {
  const row = { lang, group, method, route, status, detail }
  results.push(row)
  if (status !== 'ok') failures.push(row)
  if (VERBOSE || status !== 'ok') {
    const mark = status === 'ok' ? 'ok  ' : status === 'skip' ? 'skip' : 'FAIL'
    const suffix = detail ? '  <- ' + String(detail).split('\n')[0].slice(0, 160) : ''
    console.log(`  ${mark} [${lang}] ${group} ${method.toUpperCase()} ${route}${suffix}`)
  }
}

async function safeImport(spec) {
  try {
    return await import(spec)
  } catch (err) {
    return { __importError: err }
  }
}

// --------------------------------------------------------------- test doubles

const ejs = await safeImport('ejs')
const prismaMod = await safeImport('@prisma/client')
const i18nMod = await safeImport('../src/i18n.js')
const menuMod = await safeImport('../src/menu.js')
const registryMod = await safeImport('../src/registry.js')
const metaMod = await safeImport('../src/meta-store.js')

const mkClient = prismaMod.mkClient || (() => ({}))
const createTranslator = i18nMod.createTranslator || ((lang) => ({
  lang, t: (k) => k, tx: (s) => s,
}))

/** A prisma double seeded with a couple of plausible rows per model. */
function makePrisma() {
  const row = { ID: 1, Team: 1, Kurzname: 'Muster', Bezeichnung: 'Muster', Name: 'Muster' }
  const base = mkClient({})
  // any model returns the same shaped rows; unknown models degrade to []
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop.startsWith('$')) return target[prop]
      const delegate = target[prop]
      if (!delegate || typeof delegate !== 'object') return delegate
      return {
        ...delegate,
        findMany: async () => [row],
        findFirst: async () => row,
        findUnique: async () => row,
        count: async () => 1,
        aggregate: async () => ({ _count: 1, _sum: {} }),
        groupBy: async () => [],
      }
    },
  })
}

function buildLocals(lang, prisma) {
  const i18n = createTranslator(lang)
  const registry = registryMod.registry || registryMod.default || {}
  const moduleNames = typeof registryMod.moduleNames === 'function'
    ? registryMod.moduleNames
    : () => Object.keys(registry)
  let menu = { groups: [], sections: [] }
  try {
    if (typeof menuMod.menuFor === 'function') {
      const raw = menuMod.menuFor({ isAdmin: true, isGuest: false, canAccess: () => true })
      const groups = (raw.groups || []).map((g) => ({
        ...g,
        label: i18n.tx(g.label),
        parentLabel: i18n.tx(g.parentLabel),
        items: (g.items || []).map((it) => ({
          ...it, label: i18n.tx(it.label), title: i18n.tx(it.title),
        })),
      }))
      const byId = new Map(groups.map((g) => [g.id, g]))
      menu = {
        ...raw,
        groups,
        sections: (raw.sections || []).map((s) => ({
          ...s,
          label: i18n.tx(s.label),
          groups: (s.groups || []).map((g) => byId.get(g.id) || g),
        })),
      }
    }
  } catch { /* menu is optional for the sweep */ }

  return {
    lang: i18n.lang,
    t: i18n.t,
    tx: i18n.tx,
    user: { ID: 1, Benutzername: 'tester', isAdmin: true, admin: true, Team: 1, Waehrung: 'EUR' },
    path: '/',
    menu,
    modules: registry,
    moduleNames: moduleNames(),
    waehrung: 'EUR',
    csrfToken: 'test-csrf-token',
  }
}

function makeReq(locals, routePath, prisma) {
  const params = {}
  for (const m of routePath.matchAll(/:([A-Za-z_]+)\??/g)) params[m[1]] = '1'
  if (params.entity) params.entity = 'adressen'
  if (params.name) params.name = 'adressen'
  if (params.slug) params.slug = 'adressen'
  return {
    params,
    query: {},
    body: {},
    method: 'GET',
    path: routePath,
    originalUrl: routePath,
    baseUrl: '',
    protocol: 'http',
    headers: { host: 'localhost:3000' },
    get(name) { return this.headers[String(name).toLowerCase()] },
    session: { user: locals.user, csrfToken: 'test-csrf-token' },
    app: { locals: {} },
    prisma,
  }
}

function makeRes(locals) {
  const res = {
    statusCode: 200,
    headers: {},
    locals: { ...locals },
    finished: false,
    renderPromise: null,
    status(code) { this.statusCode = code; return this },
    sendStatus(code) { this.statusCode = code; this.finished = true; return this },
    set(key, value) { this.headers[String(key).toLowerCase()] = value; return this },
    setHeader(key, value) { this.headers[String(key).toLowerCase()] = value; return this },
    getHeader(key) { return this.headers[String(key).toLowerCase()] },
    type(value) { this.headers['content-type'] = value; return this },
    attachment(name) { this.headers['content-disposition'] = 'attachment; filename=' + name; return this },
    json(payload) { this.body = payload; this.finished = true; return this },
    send(payload) { this.body = payload; this.finished = true; return this },
    end(payload) { this.body = payload; this.finished = true; return this },
    write() { return true },
    redirect(target) { this.redirected = target; this.finished = true; return this },
    cookie() { return this },
    render(view, data = {}, cb) {
      const file = path.join(VIEWS, String(view).replace(/\.ejs$/, '') + '.ejs')
      this.renderedView = view
      if (!fs.existsSync(file)) {
        const err = new Error('view not found: ' + view)
        if (cb) return cb(err)
        this.renderPromise = Promise.reject(err)
        return this
      }
      const merged = { ...this.locals, ...data, locals: this.locals }
      this.renderPromise = Promise.resolve()
        .then(() => ejs.renderFile(file, merged, { filename: file }))
        .then((html) => { this.html = html; this.finished = true; return html })
      if (cb) this.renderPromise.then((html) => cb(null, html), (err) => cb(err))
      return this
    },
  }
  return res
}

// ------------------------------------------------------------------- the sweep

function layersOf(router) {
  if (!router) return []
  if (Array.isArray(router.layers)) return router.layers
  if (Array.isArray(router.stack)) {
    return router.stack
      .filter((l) => l.route)
      .map((l) => ({
        method: Object.keys(l.route.methods)[0],
        path: l.route.path,
        handlers: l.route.stack.map((s) => s.handle),
      }))
  }
  return []
}

async function sweepRouter(lang, group, router, prisma) {
  const locals = buildLocals(lang, prisma)
  for (const layer of layersOf(router)) {
    if (layer.method !== 'get') continue // read-only sweep: never mutate
    const routePath = String(layer.path)
    if (routePath.includes('*')) { note(lang, group, 'get', routePath, 'skip', 'wildcard'); continue }
    const handler = layer.handlers?.[layer.handlers.length - 1]
    if (typeof handler !== 'function') { note(lang, group, 'get', routePath, 'skip', 'no handler'); continue }
    const req = makeReq(locals, routePath, prisma)
    const res = makeRes(locals)
    try {
      await Promise.race([
        Promise.resolve(handler(req, res, (err) => { if (err) throw err })),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout after 5s')), 5000)),
      ])
      if (res.renderPromise) await res.renderPromise
      const code = res.statusCode
      if (code >= 500) note(lang, group, 'get', routePath, 'fail', 'HTTP ' + code)
      else note(lang, group, 'get', routePath, 'ok', 'HTTP ' + code + (res.renderedView ? ' ' + res.renderedView : ''))
    } catch (err) {
      note(lang, group, 'get', routePath, 'fail', err?.message || String(err))
    }
  }
}

async function main() {
  const prisma = makePrisma()
  const canAccess = () => true
  const teamWhere = (req, extra = {}) => ({ ...extra })
  const deps = { prisma, canAccess, teamWhere, sendMail: async () => ({}), entityNames: () => [] }

  const routerSpecs = [
    ['auth', '../routes/auth.js', (f) => f({ prisma, sendMail: async () => ({}) })],
    ['admin', '../routes/admin.js', (f) => f({ prisma, entityNames: () => [] })],
    ['ajax', '../routes/ajax.js', (f) => f()],
    ['dashboard', '../routes/dashboard.js', (f) => f(deps)],
    ['charts', '../routes/charts.js', (f) => f(deps)],
    ['reports', '../routes/reports.js', (f) => f(deps)],
    ['exports', '../routes/exports.js', (f) => f(deps)],
    ['special-exports', '../routes/special-exports.js', (f) => f(deps)],
    ['imports', '../routes/imports.js', (f) => f(deps)],
    ['print', '../routes/print.js', (f) => f(deps)],
    ['media', '../routes/media.js', (f) => f(deps)],
    ['files', '../routes/files.js', (f) => f(deps)],
    ['uploads', '../routes/uploads.js', (f) => f(deps)],
    ['settings', '../routes/settings.js', (f) => f(deps)],
    ['searches', '../routes/searches.js', (f) => f(deps)],
    ['virtual', '../routes/virtual.js', (f) => f(deps)],
    ['webhooks', '../routes/webhooks.js', (f) => f(deps)],
    ['geocoding', '../routes/geocoding.js', (f) => f(deps)],
    ['buttonhandler', '../routes/buttonhandler.js', (f) => f(deps)],
  ]

  for (const lang of LANGS) {
    console.log(`\n===== language: ${lang} =====`)

    for (const [group, spec, build] of routerSpecs) {
      const mod = await safeImport(spec)
      if (mod.__importError) {
        note(lang, group, 'get', '(module)', 'fail', 'import failed: ' + mod.__importError.message)
        continue
      }
      const factory = mod.default
      if (typeof factory !== 'function') {
        note(lang, group, 'get', '(module)', 'skip', 'no default factory')
        continue
      }
      let router
      try {
        router = build(factory)
      } catch (err) {
        note(lang, group, 'get', '(factory)', 'fail', 'factory threw: ' + err.message)
        continue
      }
      await sweepRouter(lang, group, router, prisma)
    }

    // every CRUD entity
    const crudMod = await safeImport('../routes/crud.js')
    const index = metaMod.metaIndex ? metaMod.metaIndex() : null
    const names = index
      ? (Array.isArray(index) ? index : Object.keys(index))
      : []
    if (crudMod.__importError) {
      note(lang, 'crud', 'get', '(module)', 'fail', crudMod.__importError.message)
    } else {
      let swept = 0
      for (const entry of names) {
        const name = typeof entry === 'string' ? entry : entry?.name || entry?.entity
        if (!name) continue
        let meta = null
        try {
          meta = metaMod.loadMeta ? metaMod.loadMeta(name) : null
        } catch (err) {
          note(lang, 'crud:' + name, 'get', '(meta)', 'fail', 'loadMeta threw: ' + err.message)
          continue
        }
        if (!meta) continue
        let router
        try {
          router = crudMod.default(name, meta)
        } catch (err) {
          note(lang, 'crud:' + name, 'get', '(factory)', 'fail', err.message)
          continue
        }
        await sweepRouter(lang, 'crud:' + name, router, prisma)
        swept += 1
      }
      console.log(`  (swept ${swept} CRUD entities)`)
    }
  }

  // ---------------------------------------------------------------- summary
  const total = results.length
  const ok = results.filter((r) => r.status === 'ok').length
  const skipped = results.filter((r) => r.status === 'skip').length
  const failed = failures.length
  console.log('\n================ SMOKE SUMMARY ================')
  console.log(`  routes exercised : ${total}`)
  console.log(`  ok               : ${ok}`)
  console.log(`  skipped          : ${skipped}`)
  console.log(`  FAILED           : ${failed}`)

  if (failed) {
    // group identical error messages so the report stays readable
    const byMessage = new Map()
    for (const f of failures) {
      const key = String(f.detail).split('\n')[0].slice(0, 200)
      if (!byMessage.has(key)) byMessage.set(key, [])
      byMessage.get(key).push(f)
    }
    console.log('\n---- distinct failures ----')
    for (const [message, rows] of [...byMessage.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  (${rows.length}x) ${message}`)
      for (const r of rows.slice(0, 6)) console.log(`      [${r.lang}] ${r.group} ${r.method.toUpperCase()} ${r.route}`)
      if (rows.length > 6) console.log(`      ... and ${rows.length - 6} more`)
    }
  }

  fs.writeFileSync(
    path.join(HERE, 'smoke-routes-report.json'),
    JSON.stringify({ total, ok, skipped, failed, failures }, null, 2),
  )
  console.log('\n  report: tests/smoke-routes-report.json')
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  console.error('smoke harness crashed:', err)
  process.exit(2)
})
