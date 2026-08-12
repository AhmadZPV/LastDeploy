// Minimal nodemailer stub for offline tests. Records messages, never sends.

export const sentMail = []

export function createTransport(options = {}) {
	const sent = []
	return {
		options,
		sent,
		async sendMail(message) {
			const record = { ...message, transport: options }
			sent.push(record)
			sentMail.push(record)
			return {
				messageId: `stub-${sentMail.length}@localhost`,
				accepted: [].concat(message?.to || []),
				rejected: [],
				response: '250 OK (stub)',
			}
		},
		async verify() {
			return true
		},
		close() {},
	}
}

export function getTestMessageUrl() {
	return null
}

export default { createTransport, getTestMessageUrl, sentMail }
