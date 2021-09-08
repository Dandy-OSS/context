import * as uuid from 'uuid'

export class OperationError extends Error {
	readonly failedAt: number
	constructor(message: string, readonly context: OperationContext) {
		super(message)
		this.failedAt = Date.now()
	}
}

interface OperationContextEntryJSON {
	values: Record<string, any>
	stacktrace: string[]
}

export class OperationContextEntry {
	private readonly trace: Error
	private readonly values: Record<string, any> = {}

	constructor(private readonly context: OperationContext) {
		this.trace = new Error('-----')
	}

	setValue(key: string, value: any): OperationContextEntry {
		this.values[key] = value
		return this
	}

	addHttpRequest(
		request: { method: string; url: string; body: any },
		response: { statusCode: number; body: any },
	): OperationContextEntry {
		this.setValue('request', {
			method: request.method,
			url: request.method,
			body: request.body,
		})
		this.setValue('response', {
			statusCode: response.statusCode,
			body: response.body,
		})
		return this
	}

	toJSON(): OperationContextEntryJSON {
		const stacktrace = String(this.trace.stack || this.trace).split('\n')
		return {
			values: this.values,
			// Remove the first line, it has an empty error message
			stacktrace: stacktrace.slice(1).map((line) => line.trim()),
		}
	}

	// Methods proxied back to operation

	next() {
		return this.context.next()
	}

	isRunning() { return this.context.isRunning() }

	createError(message: string): OperationError {
		return this.context.createError(message)
	}
}

export enum OperationContextStatus {
	running = 'running',
	failed = 'failed',
	cancelled = 'cancelled',
	ended = 'ended',
}

interface OperationContextJSON {
	readonly status: OperationContextStatus
	readonly operationID: string
	readonly trace: OperationContextEntryJSON[]
	readonly startedAt: number
	readonly endedAt?: number
}

export class OperationContext {
	private readonly id: string = uuid.v4()

	private status: OperationContextStatus = OperationContextStatus.running

	private trace: OperationContextEntry[] = []
	private errors: OperationError[] = []

	private readonly startedAt: number = Date.now()
	private endedAt?: number

	private timeout?: NodeJS.Timer
	private timeoutError?: Error

	isRunning(): boolean {
		return this.status === OperationContextStatus.running
	}

	next(): OperationContextEntry {
		if (this.timeoutError) {
			throw this.timeoutError
		}
		if (!this.isRunning()) {
			throw this.createError(`Cannot continue a ${this.status} operation`)
		}

		const entry = new OperationContextEntry(this)
		this.trace.push(entry)
		return entry
	}

	cancel(): OperationContext {
		if (!this.isRunning()) {
			throw this.createError(`Cannot cancel a ${this.status} operation`)
		}
		this.status = OperationContextStatus.cancelled
		return this
	}

	setTimeout(maxTime: number): OperationContext {
		if (this.timeout) {
			throw this.createError(`Cannot set another timeout on the operation`)
		}

		this.timeout = setTimeout(() => {
			if (this.isRunning()) {
				this.timeoutError = this.createError(`Operation timed out after ${maxTime}ms`)
			}
		}, maxTime)
		return this
	}

	end(): OperationContext {
		if (this.timeoutError) {
			throw this.timeoutError
		}
		if (!this.isRunning()) {
			throw this.createError(`Cannot end a ${this.status} operation`)
		}
		if (this.timeout) {
			clearTimeout(this.timeout)
		}
		this.endedAt = Date.now()
		this.status = OperationContextStatus.ended
		return this
	}

	createError(message: string): OperationError {
		if (!this.endedAt) {
			this.endedAt = Date.now()
		}
		this.status = OperationContextStatus.failed
		const err = new OperationError(message, this)
		this.errors.push(err)
		return err
	}

	getErrors(): OperationError[] {
		return this.errors
	}

	toJSON(): OperationContextJSON {
		return {
			status: this.status,
			operationID: this.id,
			trace: this.trace.map((entry) => entry.toJSON()),
			startedAt: this.startedAt,
			endedAt: this.endedAt
		}
	}
}
