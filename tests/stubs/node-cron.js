// Minimal node-cron stub for offline tests.
// Registers tasks without ever firing them, and exposes the registry so tests
// can trigger a scheduled job on demand.

export const tasks = []

function isValidExpression(expression) {
	if (typeof expression !== 'string') return false
	const fields = expression.trim().split(/\s+/)
	return fields.length >= 5 && fields.length <= 6
}

export function schedule(expression, handler, options = {}) {
	const task = {
		expression,
		handler,
		options,
		running: options.scheduled !== false,
		runs: 0,
		start() {
			this.running = true
			return this
		},
		stop() {
			this.running = false
			return this
		},
		destroy() {
			this.running = false
			const i = tasks.indexOf(this)
			if (i !== -1) tasks.splice(i, 1)
		},
		// test helper: run the job body immediately
		async trigger() {
			this.runs += 1
			return handler()
		},
	}
	tasks.push(task)
	return task
}

export function validate(expression) {
	return isValidExpression(expression)
}

export function getTasks() {
	return tasks
}

export default { schedule, validate, getTasks, tasks }
