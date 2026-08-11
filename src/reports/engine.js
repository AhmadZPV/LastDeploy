/**
 * Phase 5 - report engine.
 *
 * Stands in for the 36 generated *_report.php pages: grouped reports with
 * per-group and grand totals, flat reports, and crosstabs. Aggregations run
 * on the RAW values — the renderer formats afterwards, otherwise the German
 * thousands separator would poison every sum.
 */

/** Coerce one stored value into a number, or null when it is not numeric. */
function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value === 'string') {
    const s = value.trim();
    // German "1.234,56" only when both separators are present
    const n = /,/.test(s) && /\./.test(s)
      ? Number(s.replace(/\./g, '').replace(',', '.'))
      : Number(s.replace(',', '.'));
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * sum | avg | min | max | count over a value list.
 * An empty set aggregates to null (so the renderer prints an empty cell
 * instead of a misleading zero) — except count, which is honestly 0.
 * Numeric strings are coerced ("10" + "20" = 30).
 */
export function aggregate(values, op) {
  const list = (values || []).filter((v) => v !== null && v !== undefined);
  if (op === 'count') return list.length;
  const nums = list.map(toNumber).filter((n) => n !== null);
  if (!nums.length) return null;
  switch (op) {
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': return Math.min(...nums);
    case 'max': return Math.max(...nums);
    default: return null;
  }
}

/**
 * Grouped report: rows bucketed by the group fields, each bucket carrying
 * per-measure totals, plus a grand-total row.
 *
 * @returns {{groups: Array<{key, rows, totals}>, totals: Object}}
 */
export function buildGrouped(rows, groupFields, measureFields, op = 'sum') {
  const buckets = new Map();
  for (const row of rows || []) {
    const key = groupFields.map((f) => String(row[f] ?? '')).join('\u0001');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const groups = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, bucket]) => {
      const totals = {};
      for (const m of measureFields) totals[m] = aggregate(bucket.map((r) => r[m]), op);
      return {
        key: groupFields.length === 1 ? (bucket[0][groupFields[0]] ?? '') : key,
        fields: Object.fromEntries(groupFields.map((f) => [f, bucket[0][f]])),
        rows: bucket,
        totals,
      };
    });
  const totals = {};
  for (const m of measureFields) totals[m] = aggregate((rows || []).map((r) => r[m]), op);
  return { groups, totals };
}

/**
 * Crosstab: rows pivoted against columns. An intersection without rows stays
 * blank (null), never a fabricated zero.
 *
 * @returns {{rowKeys, colKeys, matrix: Array<{key, cells, total}>, colTotals, grand}}
 */
export function buildCrosstab(rows, rowField, colField, measure, op = 'sum') {
  const rowKeys = [...new Set((rows || []).map((r) => String(r[rowField] ?? '')))].sort();
  const colKeys = [...new Set((rows || []).map((r) => String(r[colField] ?? '')))].sort();

  const cellOf = (rk, ck) => aggregate(
    (rows || [])
      .filter((r) => String(r[rowField] ?? '') === rk && String(r[colField] ?? '') === ck)
      .map((r) => r[measure]),
    op,
  );

  const matrix = rowKeys.map((rk) => {
    const cells = colKeys.map((ck) => cellOf(rk, ck));
    const total = aggregate(
      (rows || []).filter((r) => String(r[rowField] ?? '') === rk).map((r) => r[measure]),
      op,
    );
    return { key: rk, cells, total };
  });

  const colTotals = colKeys.map((ck) => aggregate(
    (rows || []).filter((r) => String(r[colField] ?? '') === ck).map((r) => r[measure]),
    op,
  ));
  const grand = aggregate((rows || []).map((r) => r[measure]), op);

  return { rowKeys, colKeys, matrix, colTotals, grand };
}

/**
 * Which columns are measures: at least one stored value must be a genuine
 * number (or Prisma Decimal). A numeric-LOOKING string column like
 * Kontonummer ('8100') is text and must never be summed.
 */
export function numericColumns(columns, rows) {
  return (columns || []).filter((c) =>
    (rows || []).some((r) => {
      const v = r[c.prismaField];
      return typeof v === 'number'
        || (v && typeof v === 'object' && typeof v.toNumber === 'function');
    }));
}

export default { aggregate, buildGrouped, buildCrosstab, numericColumns };
