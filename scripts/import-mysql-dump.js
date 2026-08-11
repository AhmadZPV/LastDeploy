#!/usr/bin/env node
/**
 * Load prisma/dump-data/*.json (produced by scripts/dump-to-json.py) into the
 * Prisma database. Column -> field mapping is read from prisma/schema.prisma so
 * every @map/@@map is honoured exactly.
 *
 * Flags: --dry-run | --truncate | --only=Table1,Table2
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { PrismaClient } from "@prisma/client"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dataDir = path.join(root, "prisma", "dump-data")
const schemaPath = path.join(root, "prisma", "schema.prisma")

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const truncate = args.includes("--truncate")
const onlyArg = args.find((a) => a.startsWith("--only="))
const only = onlyArg ? onlyArg.slice(7).split(",").map((s) => s.trim()) : null

// Only fatal when run as a script — importing the helpers must not exit.
function ensureDataDir() {
	if (!fs.existsSync(dataDir)) {
		console.error(`missing ${dataDir} - run scripts/dump-to-json.py first`)
		process.exit(1)
	}
}

/** Parse schema.prisma into { [dbTable]: { model, fields: [...] } }. */
export function parseSchema() {
	const src = fs.readFileSync(schemaPath, "utf8")
	const models = {}
	const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
	let m
	while ((m = re.exec(src))) {
		const [, model, body] = m
		const tableMatch = body.match(/@@map\("([^"]+)"\)/)
		const table = tableMatch ? tableMatch[1] : model
		const fields = []
		for (const raw of body.split("\n")) {
			const line = raw.trim()
			if (!line || line.startsWith("//") || line.startsWith("@@")) continue
			const f = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/)
			if (!f) continue
			const [, name, type, list, optional, rest] = f
			if (list) continue // relation array
			if (/@relation/.test(rest) && !/@map/.test(rest) &&
				!/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Bytes|Json)$/.test(type)) continue
			if (!/^(String|Int|BigInt|Float|Decimal|Boolean|DateTime|Bytes|Json)$/.test(type)) continue
			const mapMatch = rest.match(/@map\("([^"]+)"\)/)
			fields.push({
				name,
				type,
				column: mapMatch ? mapMatch[1] : name,
				optional: Boolean(optional),
				hasDefault: /@default\(/.test(rest),
			})
		}
		models[table] = { model, fields }
	}
	return models
}

const ZERO_DATE = /^0{4}-0{2}-0{2}/

export function coerce(value, type) {
	if (value === null || value === undefined) return null
	if (value && typeof value === "object" && value.__hex__ !== undefined) {
		const buf = Buffer.from(value.__hex__, "hex")
		return type === "Bytes" ? buf : buf.toString("utf8")
	}
	switch (type) {
		case "Int":
		case "BigInt": {
			if (typeof value === "number") return Math.trunc(value)
			const n = parseInt(String(value).trim(), 10)
			return Number.isNaN(n) ? null : n
		}
		case "Float":
		case "Decimal": {
			if (typeof value === "number") return value
			const n = parseFloat(String(value).replace(",", "."))
			return Number.isNaN(n) ? null : n
		}
		case "Boolean":
			if (typeof value === "boolean") return value
			return ![0, "0", "", "false", "N"].includes(value)
		case "DateTime": {
			const s = String(value).trim()
			if (!s || ZERO_DATE.test(s)) return null
			const iso = s.includes("T") ? s : s.replace(" ", "T") +
				(s.length <= 10 ? "T00:00:00.000Z" : "Z")
			const d = new Date(iso)
			return Number.isNaN(d.getTime()) ? null : d
		}
		case "Bytes":
			return Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")
		default:
			return typeof value === "string" ? value : String(value)
	}
}

// Loaded lazily: importing the helpers (tests) must not require dump data.
let _manifest = null
function manifest() {
	if (!_manifest) {
		_manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "_manifest.json"), "utf8"))
	}
	return _manifest
}
const schema = parseSchema()
const prisma = new PrismaClient()
const report = []

export function mapRow(row, fields) {
	const out = {}
	for (const f of fields) {
		if (!(f.column in row)) continue
		const v = coerce(row[f.column], f.type)
		if (v === null && !f.optional) {
			if (f.hasDefault) continue
			out[f.name] = f.type === "String" ? "" : 0
			continue
		}
		out[f.name] = v
	}
	return out
}

async function run() {
	for (const [table, info] of Object.entries(manifest())) {
		if (only && !only.includes(table)) continue
		const target = schema[table]
		if (!target) {
			report.push({ table, expected: info.rows, inserted: 0, status: "NO MODEL" })
			continue
		}
		const delegate = prisma[target.model[0].toLowerCase() + target.model.slice(1)]
		if (!delegate) {
			report.push({ table, expected: info.rows, inserted: 0, status: "NO DELEGATE" })
			continue
		}
		const rows = JSON.parse(fs.readFileSync(path.join(dataDir, info.file), "utf8"))
		const mapped = rows.map((r) => mapRow(r, target.fields))

		if (dryRun) {
			report.push({ table, expected: info.rows, inserted: mapped.length, status: "DRY" })
			continue
		}
		if (truncate) await delegate.deleteMany({})

		let inserted = 0
		const BATCH = 500
		for (let i = 0; i < mapped.length; i += BATCH) {
			const chunk = mapped.slice(i, i + BATCH)
			try {
				const res = await delegate.createMany({ data: chunk })
				inserted += res?.count ?? chunk.length
			} catch {
				// fall back so one bad row cannot lose the whole batch
				for (const row of chunk) {
					try {
						await delegate.create({ data: row })
						inserted++
					} catch (err) {
						console.error(`  ${table}: skipped row - ${err.message.split("\n")[0]}`)
					}
				}
			}
		}
		const status = inserted === info.rows ? "OK" : "MISMATCH"
		report.push({ table, expected: info.rows, inserted, status })
		console.log(`${status.padEnd(9)} ${table.padEnd(34)} ${inserted}/${info.rows}`)
	}

	console.log("\n--- parity report ---")
	const bad = report.filter((r) => r.status !== "OK" && r.status !== "DRY")
	const totalExpected = report.reduce((s, r) => s + r.expected, 0)
	const totalInserted = report.reduce((s, r) => s + r.inserted, 0)
	console.log(`tables: ${report.length}  rows: ${totalInserted}/${totalExpected}`)
	if (bad.length === 0) {
		console.log(`All ${report.length} tables match the dump row counts.`)
	} else {
		console.log("Tables needing attention:")
		for (const r of bad) console.log(`  ${r.status} ${r.table} ${r.inserted}/${r.expected}`)
		process.exitCode = 1
	}
}

const isMain = process.argv[1]
	&& import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isMain) {
	ensureDataDir()
	run()
		.catch((e) => { console.error(e); process.exitCode = 1 })
		.finally(() => prisma.$disconnect())
}
