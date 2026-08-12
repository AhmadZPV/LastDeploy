// Minimal sanitize-html stub for offline tests.
// Strips dangerous constructs so the sanitising code path is still exercised.

const DEFAULT_ALLOWED = [
	'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'ul', 'ol', 'li',
	'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
	'span', 'div', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr',
]

export function sanitizeHtml(dirty, options = {}) {
	if (dirty === undefined || dirty === null) return ''
	let out = String(dirty)
	const allowed = new Set(
		(options.allowedTags || DEFAULT_ALLOWED).map((t) => String(t).toLowerCase()),
	)
	out = out.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, '')
	out = out.replace(/<(script|style|iframe|object|embed)\b[^>]*\/?>/gi, '')
	out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
	out = out.replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"')
	out = out.replace(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g, (tag, name) =>
		allowed.has(String(name).toLowerCase()) ? tag : '',
	)
	return out
}

// Mirrors the real library's helper: returns a transform function that
// rewrites a tag name and merges (or replaces) its attributes.
export function simpleTransform(newTagName, newAttribs = {}, merge = true) {
	return function transform(tagName, attribs) {
		const attributes = merge ? { ...attribs, ...newAttribs } : { ...newAttribs }
		return { tagName: newTagName, attribs: attributes }
	}
}

sanitizeHtml.simpleTransform = simpleTransform
sanitizeHtml.defaults = { allowedTags: DEFAULT_ALLOWED, allowedAttributes: { a: ['href'] } }

export default sanitizeHtml
