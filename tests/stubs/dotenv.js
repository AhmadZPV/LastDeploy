// Minimal dotenv stub for offline tests: parses a .env file into process.env.

import fs from 'node:fs'
import path from 'node:path'

export function parse(src) {
	const out = {}
	for (const rawLine of String(src).split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith('#')) continue
		const eq = line.indexOf('=')
		if (eq === -1) continue
		const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
		let value = line.slice(eq + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		out[key] = value
	}
	return out
}

export function config(options = {}) {
	const file = options.path || path.resolve(process.cwd(), '.env')
	try {
		const parsed = parse(fs.readFileSync(file, 'utf8'))
		for (const [key, value] of Object.entries(parsed)) {
			if (options.override || process.env[key] === undefined) process.env[key] = value
		}
		return { parsed }
	} catch (error) {
		return { error }
	}
}

export default { config, parse }
