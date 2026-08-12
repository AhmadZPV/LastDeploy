// Minimal but *real* EJS engine for offline testing.
// It genuinely compiles and executes the project's templates, so template
// syntax errors, undefined locals and broken includes still surface.
// Supported: <% %>, <%= %>, <%- %>, <%# %>, whitespace slurp, include(), caching.

import fs from 'node:fs'
import path from 'node:path'

const cache = new Map()

const ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' }

export function escapeXML(value) {
	if (value === undefined || value === null) return ''
	return String(value).replace(/[&<>'"]/g, (c) => ESCAPE[c])
}

function resolveInclude(name, parentFile) {
	let target = name
	if (!path.extname(target)) target += '.ejs'
	if (path.isAbsolute(target)) return target
	const base = parentFile ? path.dirname(parentFile) : process.cwd()
	return path.resolve(base, target)
}

function buildSource(template) {
	const parts = []
	const re = /<%(_|-|=|#)?([\s\S]*?)(_|-)?%>/g
	let last = 0
	let match
	while ((match = re.exec(template)) !== null) {
		let text = template.slice(last, match.index)
		if (match[1] === '_') text = text.replace(/[ \t]*$/, '')
		if (text) parts.push('__out += ' + JSON.stringify(text) + ';')
		const type = match[1]
		const code = match[2]
		if (type === '=') {
			parts.push('__out += __escape(' + (code.trim() || "''") + ');')
		} else if (type === '-') {
			parts.push('__out += (function(){ var __v = (' + (code.trim() || "''") + '); return __v === undefined || __v === null ? "" : __v; })();')
		} else if (type === '#') {
			// comment: emit nothing
		} else {
			parts.push(code + '\n')
		}
		last = re.lastIndex
		if (match[3]) {
			const rest = template.slice(last)
			const nl = /^[ \t]*\r?\n/.exec(rest)
			if (nl) last += nl[0].length
		}
	}
	const tail = template.slice(last)
	if (tail) parts.push('__out += ' + JSON.stringify(tail) + ';')
	return parts.join('\n')
}

export function compile(template, options = {}) {
	const body = buildSource(template)
	const src = 'var __out = "";\nwith (locals || {}) {\n' + body + '\n}\nreturn __out;'
	let fn
	try {
		fn = new Function('locals', '__escape', 'include', src)
	} catch (err) {
		err.message = 'EJS compile error in ' + (options.filename || '<template>') + ': ' + err.message
		throw err
	}
	return function render(data = {}) {
		const include = (name, extra) => {
			const file = resolveInclude(name, options.filename)
			return loadFile(file)({ ...data, ...(extra || {}) })
		}
		try {
			return fn(data, escapeXML, include)
		} catch (err) {
			err.message = 'EJS render error in ' + (options.filename || '<template>') + ': ' + err.message
			throw err
		}
	}
}

function loadFile(file) {
	const stat = fs.statSync(file)
	const key = file + ':' + stat.mtimeMs
	if (cache.has(key)) return cache.get(key)
	const fn = compile(fs.readFileSync(file, 'utf8'), { filename: file })
	cache.set(key, fn)
	return fn
}

export function render(template, data = {}, options = {}) {
	return compile(template, options)(data)
}

export function renderFile(file, data = {}, options = {}, cb) {
	if (typeof options === 'function') {
		cb = options
		options = {}
	}
	if (typeof data === 'function') {
		cb = data
		data = {}
	}
	try {
		const out = loadFile(path.resolve(file))(data)
		if (cb) return cb(null, out)
		return Promise.resolve(out)
	} catch (err) {
		if (cb) return cb(err)
		return Promise.reject(err)
	}
}

export const __express = renderFile

export default { compile, render, renderFile, __express, escapeXML, cache }
