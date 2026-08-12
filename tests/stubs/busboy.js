// Minimal busboy stub for offline tests.
// Parses simple multipart/form-data bodies well enough for upload routes.

import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

function boundaryOf(headers = {}) {
	const ct = headers['content-type'] || headers['Content-Type'] || ''
	const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct)
	return m ? (m[1] || m[2]).trim() : null
}

class Busboy extends EventEmitter {
	constructor(options = {}) {
		super()
		this.options = options
		this.boundary = boundaryOf(options.headers)
		this._chunks = []
	}

	write(chunk) {
		this._chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
		return true
	}

	end(chunk) {
		if (chunk) this.write(chunk)
		setImmediate(() => this._parse())
	}

	_parse() {
		const body = Buffer.concat(this._chunks)
		if (!this.boundary) {
			this.emit('finish')
			return
		}
		const parts = body.toString('binary').split('--' + this.boundary)
		for (const part of parts) {
			if (!part || part === '--' || part === '--\r\n') continue
			const split = part.indexOf('\r\n\r\n')
			if (split === -1) continue
			const rawHeaders = part.slice(0, split)
			let content = part.slice(split + 4).replace(/\r\n$/, '')
			const nameMatch = /name="([^"]*)"/i.exec(rawHeaders)
			const fileMatch = /filename="([^"]*)"/i.exec(rawHeaders)
			const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders)
			if (!nameMatch) continue
			const name = nameMatch[1]
			if (fileMatch) {
				const stream = Readable.from([Buffer.from(content, 'binary')])
				stream.truncated = false
				this.emit('file', name, stream, {
					filename: fileMatch[1],
					encoding: '7bit',
					mimeType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
				})
			} else {
				this.emit('field', name, Buffer.from(content, 'binary').toString('utf8'), {
					nameTruncated: false,
					valueTruncated: false,
				})
			}
		}
		this.emit('finish')
		this.emit('close')
	}
}

export function busboy(options = {}) {
	return new Busboy(options)
}

export default busboy
