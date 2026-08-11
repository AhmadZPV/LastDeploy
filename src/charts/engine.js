/**
 * Phase 6 - chart engine. Replaces the 18 generated *_chart.php pages plus
 * dchartdata.php and classes/charts.php (2,407 lines).
 *
 * Faithfulness notes, all taken from the PHP source:
 *
 *  - classes/charts.php:220
 *        for ($i = 0; $i < count($parameters) - 1; $i++)
 *    The LAST entry in <attr value="parameters"> is the category (label) axis;
 *    every entry before it is a value series. The extractor already split them.
 *
 *  - classes/charts.php:1066 (get_data) emits one point per SQL row and does
 *    NOT aggregate in PHP. The aggregation is entirely in the SQL, and the
 *    GROUP BY does not live in .sqlTail - it is in the serialised SQLQuery
 *    object ($proto0["m_groupby"]). extract-charts.py recovers it.
 *
 *  - dchartdata.php maps 3d_* types onto their 2d counterparts plus an is3d
 *    appearance flag. Our normalised types keep that split.
 *
 * The source SQL is MySQL. This project runs on SQLite, so translateSql()
 * rewrites the dialect-specific constructs. Anything it cannot translate is
 * reported honestly rather than silently producing wrong numbers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHARTS_JSON = path.join(HERE, '..', 'meta', 'charts.json');

let _cache = null;

/** Load and memoise src/meta/charts.json. */
export function charts() {
  if (!_cache) {
    _cache = JSON.parse(fs.readFileSync(CHARTS_JSON, 'utf8'));
  }
  return _cache;
}

export function listCharts() {
  const all = charts().charts;
  return Object.keys(all).sort().map((k) => ({
    entity: k,
    displayName: all[k].displayName,
    type: all[k].chartType,
    baseTable: all[k].baseTable,
    series: all[k].series,
    category: all[k].category,
    translated: all[k].mysqlOnly.length > 0,
  }));
}

/** Case-insensitive chart lookup, mirroring checkTableName() in dchartdata.php. */
export function getChart(name) {
  const all = charts().charts;
  if (!name) return null;
  if (all[name]) return { ...all[name], entity: name };
  const lower = String(name).toLowerCase();
  let hit = Object.keys(all).find((k) => k.toLowerCase() === lower);
  if (hit) return { ...all[hit], entity: hit };
  // Digraph form (verkaeufer) ↔ underscore file form (Verk_ufer)
  const asFile = String(name)
    .replace(/ä/gi, '_')
    .replace(/ö/gi, '_')
    .replace(/ü/gi, '_')
    .replace(/ß/gi, '_')
    .replace(/ae/gi, '_')
    .replace(/oe/gi, '_')
    .replace(/ue/gi, '_')
    .replace(/ss/gi, '_');
  hit = Object.keys(all).find((k) => k.toLowerCase() === asFile.toLowerCase()
    || k.toLowerCase().replace(/_/g, '') === lower.replace(/_/g, '').replace(/ae|oe|ue|ss/g, ''));
  if (hit) return { ...all[hit], entity: hit };
  return null;
}

// ---------------------------------------------------------------- SQL dialect

/** Split a function argument list on top-level commas. */
export function splitArgs(s) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Rewrite one MySQL function call into SQLite, innermost first.
 * Returns null when the function is left untouched.
 */
function rewriteCall(name, args) {
  switch (name.toLowerCase()) {
    case 'concat':
      return '(' + args.join(' || ') + ')';
    case 'if':
      // Force REAL metadata only when the branches are numeric expressions.
      // Text branches (for example Leerstand/Vermietet) must remain strings.
      if (/[+*/]|(?:^|[^\w])-\s*\d|betrag/i.test(`${args[1]} ${args[2]}`)) {
        return `CAST(iif(${args[0]}, ${args[1]}, ${args[2]}) AS REAL)`;
      }
      return 'iif(' + args.join(', ') + ')';
    case 'datediff':
      // MySQL DATEDIFF(a, b) = whole days between a and b
      return `CAST(julianday(${args[0]}) - julianday(${args[1]}) AS INTEGER)`;
    case 'date_format': {
      const fmt = args[1];
      return `strftime(${fmt}, ${args[0]})`;
    }
    case 'year':
      return `CAST(strftime('%Y', ${args[0]}) AS INTEGER)`;
    case 'month':
      return `CAST(strftime('%m', ${args[0]}) AS INTEGER)`;
    case 'curdate':
      return "date('now')";
    case 'sum':
      // SQLite may report SUM(Decimal) as int64 metadata even when a later row
      // makes the result fractional, which Prisma then cannot decode as BigInt.
      // TOTAL has the same aggregate role for charts and always returns REAL.
      return `total(${args[0]})`;
    default:
      return null;
  }
}

/** Apply function rewrites repeatedly until the SQL stops changing. */
function rewriteFunctions(sql) {
  const NAMES = /\b(concat|if|datediff|date_format|year|month|curdate|sum)\s*\(/i;
  for (let pass = 0; pass < 40; pass++) {
    const m = NAMES.exec(sql);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    // find the matching close paren
    let depth = 0;
    let quote = null;
    let close = -1;
    for (let i = open; i < sql.length; i++) {
      const c = sql[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === "'" || c === '"') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { close = i; break; } }
    }
    if (close === -1) break;
    const inner = sql.slice(open + 1, close);
    // translate the arguments first so nesting resolves bottom-up
    const args = splitArgs(inner).map((a) => rewriteFunctions(a));
    const replacement = rewriteCall(m[1], args);
    if (replacement === null) break;
    sql = sql.slice(0, m.index) + replacement + sql.slice(close + 1);
  }
  return sql;
}

/** MySQL uses "x" for strings; SQLite reads that as an identifier. */
function doubleQuotedToSingle(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {                       // pass single-quoted strings through
      const end = sql.indexOf("'", i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let body = '';
      while (j < sql.length) {
        if (sql[j] === '\\' && j + 1 < sql.length) { body += sql[j + 1]; j += 2; continue; }
        if (sql[j] === '"') break;
        body += sql[j];
        j++;
      }
      out += "'" + body.replace(/'/g, "''") + "'";
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Translate a MySQL chart query into SQLite.
 *
 * Handles: session variables (@x := expr, inlined at every use site),
 * backtick identifiers, double-quoted string literals, and the date/string
 * functions listed in rewriteCall().
 *
 * @returns {{sql: string, notes: string[], unsupported: string[]}}
 */
export function translateSql(mysql) {
  const notes = [];
  const unsupported = [];
  let sql = String(mysql || '');

  // 1. session variables: capture "@name := expr AS alias" and inline later uses
  const vars = new Map();
  sql = sql.replace(/@(\w+)\s*:=\s*/g, (_m, name) => {
    vars.set(name, true);
    notes.push(`inlined session variable @${name}`);
    return '';
  });
  for (const name of vars.keys()) {
    // Many charts only use "@x := expr AS alias" as a write, never reading it
    // back (e.g. Kontostaende). Stripping the assignment is then the whole job.
    if (!new RegExp(`@${name}\\b`).test(sql)) continue;

    // Otherwise the value is read later (e.g. @anfang in the Abrechnungskonten
    // chart), so the defining expression has to be inlined at each use site.
    // The expression may contain commas, so scan the aliased select item with
    // paren awareness instead of a naive [^,]+ match.
    const expr = selectItemAliased(sql, name);
    if (expr) {
      sql = sql.replace(new RegExp(`@${name}\\b`, 'g'), '(' + expr + ')');
    } else {
      unsupported.push(`@${name} had no resolvable expression`);
    }
  }

  // 2. string literals before identifier quoting, or the two collide
  sql = doubleQuotedToSingle(sql);

  // 3. backtick identifiers -> standard double quotes
  sql = sql.replace(/`([^`]*)`/g, (_m, id) => '"' + id.replace(/"/g, '""') + '"');

  // 4. dialect functions
  const before = sql;
  sql = rewriteFunctions(sql);
  if (sql !== before) notes.push('rewrote MySQL date/string functions');

  if (/@\w+/.test(sql)) unsupported.push('unresolved session variable remains');

  return { sql: sql.trim(), notes, unsupported };
}

/**
 * Find the select-list item aliased as `alias` and return its expression.
 * Paren- and quote-aware, so expressions containing commas survive.
 */
function selectItemAliased(sql, alias) {
  const re = new RegExp(`\\s+as\\s+${alias}\\b`, 'i');
  const m = re.exec(sql);
  if (!m) return null;
  // walk backwards from the alias to the start of this select item
  let depth = 0;
  let i = m.index - 1;
  let start = 0;
  for (; i >= 0; i--) {
    const c = sql[i];
    if (c === ')') depth++;
    else if (c === '(') {
      if (depth === 0) { start = i + 1; break; }
      depth--;
    } else if (c === ',' && depth === 0) { start = i + 1; break; }
  }
  const expr = sql.slice(start, m.index).trim();
  return expr || null;
}

/** PHPRunner leaves unresolved PHP variables (e.g. $tstrOrderBy) in settings. */
const literal = (s) => (!s || String(s).trim().startsWith('$') ? '' : String(s).trim());

/**
 * Assemble the full chart query: head + from + where + group by + tail.
 *
 * @param spec chart spec from charts.json
 * @param opts.extraWhere additional SQL predicate (already safe/parameterised)
 * @param opts.limit optional row cap
 */
export function buildChartSql(spec, opts = {}) {
  const parts = [literal(spec.sql.head), literal(spec.sql.from)];

  const wheres = [];
  const own = literal(spec.sql.where);
  if (own) wheres.push('(' + own + ')');
  if (opts.extraWhere) wheres.push('(' + opts.extraWhere + ')');
  if (wheres.length) parts.push('WHERE ' + wheres.join(' AND '));

  // GROUP BY comes from the serialised SQLQuery, not from sqlTail
  if (spec.groupBy && spec.groupBy.length) {
    parts.push('GROUP BY ' + spec.groupBy.map((g) => '`' + g.name + '`').join(', '));
  }

  const tail = literal(spec.sql.tail);
  if (tail) parts.push(tail);

  const order = literal(spec.sql.orderBy);
  if (order) parts.push(order);

  if (opts.limit) parts.push('LIMIT ' + Number(opts.limit));

  return translateSql(parts.filter(Boolean).join(' '));
}

// ------------------------------------------------------------------ shaping

const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  // charts.php:1107 does str_replace(",", ".", $value) + 0
  const n = Number(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
};

/**
 * Turn raw SQL rows into the chart payload.
 * Mirrors the shape produced by Chart::get_data() / getSeriesData().
 */
export function toChartData(spec, rows) {
  const labels = rows.map((r) => {
    const v = r[spec.category];
    return v === null || v === undefined || v === '' ? '(leer)' : String(v);
  });

  const series = spec.series.map((name) => ({
    name,
    data: rows.map((r) => toNum(r[name])),
  }));

  return {
    entity: spec.entity,
    type: spec.chartType,
    title: spec.titles.head || spec.displayName,
    footer: spec.titles.foot || '',
    yAxisLabel: spec.titles.yAxisLabel || '',
    categoryField: spec.category,
    labels,
    series,
    appearance: spec.appearance,
    rowCount: rows.length,
    noDataMessage: rows.length ? null : 'Keine Daten vorhanden',
  };
}

// ------------------------------------------------------------------ rendering

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A fixed palette keeps colours stable between reloads.
const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948',
  '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac', '#86bcb6', '#d37295',
];
const colour = (i) => PALETTE[i % PALETTE.length];

const fmtDe = (n) => (n === null || n === undefined
  ? ''
  : Number(n).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

/** Doughnut / pie as inline SVG. No external chart library is available. */
function renderPie(data, { size = 420, doughnut = true } = {}) {
  const values = (data.series[0]?.data || []).map((v) => (v === null ? 0 : Math.abs(v)));
  const total = values.reduce((a, b) => a + b, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const rInner = doughnut ? r * 0.55 : 0;

  if (!total) return `<svg width="${size}" height="${size}"></svg>`;

  let angle = -Math.PI / 2;
  const arcs = values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const x1 = cx + r * Math.cos(angle);
    const y1 = cy + r * Math.sin(angle);
    const end = angle + sweep;
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = sweep > Math.PI ? 1 : 0;
    let d;
    if (rInner) {
      const xi2 = cx + rInner * Math.cos(end);
      const yi2 = cy + rInner * Math.sin(end);
      const xi1 = cx + rInner * Math.cos(angle);
      const yi1 = cy + rInner * Math.sin(angle);
      d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} `
        + `A ${rInner} ${rInner} 0 ${large} 0 ${xi1} ${yi1} Z`;
    } else {
      d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    }
    angle = end;
    const pct = ((v / total) * 100).toFixed(1);
    return `<path d="${d}" fill="${colour(i)}" stroke="#fff" stroke-width="1">`
      + `<title>${esc(data.labels[i])}: ${esc(fmtDe(v))} (${pct}%)</title></path>`;
  }).join('\n');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img">${arcs}</svg>`;
}

/** Grouped column (vertical) or bar (horizontal) chart as inline SVG. */
function renderBars(data, { horizontal = false, width = 760, rowH = 26 } = {}) {
  const series = data.series;
  const n = data.labels.length;
  if (!n) return '<svg width="10" height="10"></svg>';

  const all = series.flatMap((s) => s.data.map((v) => (v === null ? 0 : v)));
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = (max - min) || 1;

  const padL = horizontal ? 190 : 60;
  const padB = horizontal ? 30 : 90;
  const padT = 20;
  const plotW = width - padL - 30;
  const height = horizontal
    ? padT + padB + n * series.length * rowH + n * 8
    : 420;
  const plotH = height - padT - padB;

  const bars = [];
  const groupSize = series.length;

  for (let i = 0; i < n; i++) {
    for (let s = 0; s < groupSize; s++) {
      const raw = series[s].data[i];
      const v = raw === null ? 0 : raw;
      const frac = (v - min) / span;
      const zeroFrac = (0 - min) / span;
      const tip = `<title>${esc(data.labels[i])} \u2013 ${esc(series[s].name)}: `
        + `${esc(fmtDe(raw))}</title>`;

      if (horizontal) {
        const bh = rowH - 4;
        const y = padT + (i * (groupSize * rowH + 8)) + s * rowH;
        const x0 = padL + zeroFrac * plotW;
        const x1 = padL + frac * plotW;
        bars.push(`<rect x="${Math.min(x0, x1)}" y="${y}" width="${Math.abs(x1 - x0)}" `
          + `height="${bh}" fill="${colour(s)}">${tip}</rect>`);
        if (s === 0) {
          bars.push(`<text x="${padL - 8}" y="${y + bh * 0.8}" text-anchor="end" `
            + `font-size="11">${esc(data.labels[i].slice(0, 30))}</text>`);
        }
      } else {
        const slot = plotW / n;
        const bw = Math.max(2, (slot * 0.8) / groupSize);
        const x = padL + i * slot + slot * 0.1 + s * bw;
        const yZero = padT + plotH - zeroFrac * plotH;
        const yVal = padT + plotH - frac * plotH;
        bars.push(`<rect x="${x}" y="${Math.min(yZero, yVal)}" width="${bw}" `
          + `height="${Math.abs(yVal - yZero)}" fill="${colour(s)}">${tip}</rect>`);
        if (s === 0) {
          const lx = padL + i * slot + slot / 2;
          bars.push(`<text x="${lx}" y="${padT + plotH + 12}" font-size="10" `
            + `transform="rotate(45 ${lx} ${padT + plotH + 12})">`
            + `${esc(data.labels[i].slice(0, 22))}</text>`);
        }
      }
    }
  }

  const axis = horizontal
    ? `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#999"/>`
    : `<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" `
      + 'stroke="#999"/>';

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" `
    + `role="img">${axis}\n${bars.join('\n')}</svg>`;
}

/** Legend shared by all chart types. */
function renderLegend(data) {
  if (!data.appearance.legend) return '';
  const items = data.type === 'doughnut' || data.type === 'pie'
    ? data.labels.map((l, i) => ({ label: l, i }))
    : data.series.map((s, i) => ({ label: s.name, i }));
  return '<ul class="legend">' + items.map((it) =>
    `<li><span class="swatch" style="background:${colour(it.i)}"></span>`
    + `${esc(it.label)}</li>`).join('') + '</ul>';
}

/** Data table under the chart - keeps the page useful without JavaScript. */
function renderTable(data) {
  const head = '<tr><th>' + esc(data.categoryField) + '</th>'
    + data.series.map((s) => `<th>${esc(s.name)}</th>`).join('') + '</tr>';
  const body = data.labels.map((l, i) =>
    '<tr><td>' + esc(l) + '</td>'
    + data.series.map((s) => `<td class="num">${esc(fmtDe(s.data[i]))}</td>`).join('')
    + '</tr>').join('');
  return `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function chartBody(data, extra = {}) {
  const safe = {
    title: data?.title || '',
    type: data?.type || 'bar',
    rowCount: data?.rowCount ?? 0,
    labels: data?.labels || [],
    series: data?.series || [],
    categoryField: data?.categoryField || '',
    appearance: data?.appearance || {},
    noDataMessage: data?.noDataMessage,
    footer: data?.footer,
  };
  let svg;
  try {
    if (safe.type === 'doughnut' || safe.type === 'pie') {
      svg = renderPie(safe, { doughnut: safe.type === 'doughnut' });
    } else if (safe.type === 'bar') {
      svg = renderBars(safe, { horizontal: true });
    } else {
      svg = renderBars(safe, { horizontal: false });
    }
  } catch {
    svg = '<p class="empty">—</p>';
  }

  const warn = extra.warning
    ? `<p class="warn">${esc(extra.warning)}</p>`
    : '';
  const empty = safe.noDataMessage
    ? `<p class="empty">${esc(safe.noDataMessage)}</p>`
    : '';

  let legend = '';
  let table = '';
  try { legend = renderLegend(safe); } catch { legend = ''; }
  try { table = renderTable(safe); } catch { table = ''; }

  return `<h1 class="chart-title">${esc(safe.title)}</h1>
<p class="sub">${esc(safe.rowCount)} \u00b7 ${esc(safe.type)}</p>
${warn}${empty}
<div class="wrap chart-wrap">${svg}${legend}</div>
${table}
${safe.footer ? `<p class="foot">${esc(safe.footer)}</p>` : ''}`;
}

const CHART_CSS = `
 .chart-frag{font-family:Segoe UI,Arial,sans-serif;color:#222}
 .chart-frag .chart-title, .chart-frag h1{font-size:18px;margin:0 0 4px}
 .chart-frag .sub{color:#666;font-size:12px;margin:0 0 12px}
 .chart-frag .wrap,.chart-wrap{display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start}
 .chart-frag .legend{list-style:none;padding:0;margin:0;font-size:13px}
 .chart-frag .legend li{margin:0 0 6px;display:flex;align-items:center}
 .chart-frag .swatch{width:12px;height:12px;border-radius:2px;display:inline-block;margin-right:8px}
 .chart-frag table.data{border-collapse:collapse;margin-top:16px;font-size:13px}
 .chart-frag table.data th,.chart-frag table.data td{border:1px solid #ddd;padding:4px 10px}
 .chart-frag table.data th{background:#f5f5f5;text-align:left}
 .chart-frag td.num{text-align:right;font-variant-numeric:tabular-nums}
 .chart-frag .warn{background:#fff6e0;border-left:3px solid #e0a800;padding:8px 12px;font-size:12px}
 .chart-frag .empty{color:#888;font-style:italic}
 .chart-frag .foot{color:#666;font-size:12px;margin-top:12px}
`;

/** Embeddable chart body for dashboards (no full HTML document). */
export function renderChartFragment(data, extra = {}) {
  return `<div class="chart-frag"><style>${CHART_CSS}</style>${chartBody(data, extra)}</div>`;
}

/** Full standalone HTML page for one chart. */
export function renderChartHtml(data, extra = {}) {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<title>${esc(data.title)}</title>
<style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#222}
 h1{font-size:20px;margin:0 0 4px}
 .sub{color:#666;font-size:12px;margin:0 0 16px}
 .wrap{display:flex;gap:32px;flex-wrap:wrap;align-items:flex-start}
 .legend{list-style:none;padding:0;margin:0;font-size:13px;columns:1}
 .legend li{margin:0 0 6px;display:flex;align-items:center}
 .swatch{width:12px;height:12px;border-radius:2px;display:inline-block;margin-right:8px}
 table.data{border-collapse:collapse;margin-top:24px;font-size:13px}
 table.data th,table.data td{border:1px solid #ddd;padding:4px 10px}
 table.data th{background:#f5f5f5;text-align:left}
 td.num{text-align:right;font-variant-numeric:tabular-nums}
 .warn{background:#fff6e0;border-left:3px solid #e0a800;padding:8px 12px;font-size:12px}
 .empty{color:#888;font-style:italic}
 .foot{color:#666;font-size:12px;margin-top:16px}
</style></head><body>
${chartBody(data, extra)}
</body></html>`;
}

export const _internal = { renderPie, renderBars, fmtDe, esc, toNum };
