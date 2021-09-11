import * as uuid from 'uuid'
import { Cond } from './cond'

/**
 * An error created using a context.
 */
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
	private readonly trace: string[]
	private readonly values: Record<string, any> = {}

	constructor(private readonly context: OperationContext) {
		const error = new Error('-----')
		const stacktrace = String(error.stack || error).split('\n')

		this.trace = stacktrace
			// Remove the first line, it has an empty error message
			.slice(1)
			.map((line) => line.trim())
			// Remove internal lines
			.filter((line) => {
				if (!line.includes(__dirname)) {
					return true
				}
				if (process.env.NODE_ENV === 'test') {
					return line.includes('/__test__/')
				}
				return false
			})
	}

	/**
	 * Sets one or multiple values on the current context. If the keys already
	 * exist, they will be overwritten.
	 * @param values additional values to append
	 */
	setValues(values: Record<string, any>): OperationContextEntry {
		Object.assign(this.values, values)
		return this
	}

	/**
	 * Given a request and response, appends the key information from both
	 * onto the current context.
	 * @param request
	 * @param response
	 */
	addHttpRequest(
		request: { method: string; url: string; body: any },
		response: { statusCode: number; body: any },
	): OperationContextEntry {
		this.setValues({
			request: {
				method: request.method,
				url: request.method,
				body: request.body,
			},
			response: {
				statusCode: response.statusCode,
				body: response.body,
			},
		})
		return this
	}

	toJSON(): OperationContextEntryJSON {
		return {
			values: this.values,
			stacktrace: this.trace,
		}
	}

	// Methods proxied back to operation

	/**
	 * Extends the context to another stack entry.
	 */
	next() {
		return this.context.next()
	}

	/**
	 * @returns isRunning true if the operation is still running
	 */
	isRunning() {
		return this.context.isRunning()
	}

	/**
	 * Fails the top-level operation.
	 * @param message error message
	 */
	createError(message: string): OperationError {
		return this.context.createError(message)
	}
}

export enum OperationContextStatus {
	/**
	 * Represents a created but not yet ended operation.
	 */
	running = 'running',

	/**
	 * Represents an operation that has experienced at least one error.
	 */
	failed = 'failed',

	/**
	 * Represents an operation that received a cancellation signal.
	 */
	cancelled = 'cancelled',

	/**
	 * Represents an operation that received an end signal and did not
	 * experience any errors.
	 */
	ended = 'ended',
}

interface OperationContextJSON {
	readonly status: OperationContextStatus
	readonly operationID: string
	readonly trace: OperationContextEntryJSON[]
	readonly startedAt: number
	readonly endedAt?: number
}

/**
 * @class OperationContext
 *
 * Responsible for managing the overall asynchronous operation. This
 * object should not be passed after the parent that creates the operation.
 */
export class OperationContext {
	private readonly id: string

	private status: OperationContextStatus = OperationContextStatus.running
	private readonly waitCond

	private trace: OperationContextEntry[] = []
	private errors: OperationError[] = []

	private readonly startedAt: number = Date.now()
	private endedAt?: number

	private timeout?: NodeJS.Timer
	private timeoutError?: Error

	private readonly activeProcesses: PromiseLike<void>[] = []

	constructor() {
		this.id = uuid.v4()
		this.waitCond = new Cond(this.id)
		this.waitCond.lock()
	}

	/**
	 * @returns {boolean} true if the operation is currently running
	 * check this method to exit gracefully when operations are cancelled
	 */
	isRunning(): boolean {
		return this.status === OperationContextStatus.running
	}

	/**
	 * Sets the status to an ending status, and unlocks any waiters.
	 * @internal
	 */
	private setStatus(
		status:
			| OperationContextStatus.ended
			| OperationContextStatus.failed
			| OperationContextStatus.cancelled,
	): void {
		this.status = status
		this.endedAt = Date.now()
		this.waitCond.unlock()
	}

	/**
	 * Creates a new stack entry in the operation. Ideally, call this when calling a new
	 * asynchronous operation to track its context separately while attached to the high-level
	 * operation.
	 */
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

	/**
	 * Sends a cancellation signal. After this is called, the context can no longer
	 * be extended via `.next()`.
	 */
	cancel(): OperationContext {
		if (!this.isRunning()) {
			throw this.createError(`Cannot cancel a ${this.status} operation`)
		}
		this.setStatus(OperationContextStatus.cancelled)
		return this
	}

	/**
	 * Sets a timeout on the context. If the context is not ended within this time,
	 * the context will be forcefully failed with a timeout error.
	 *
	 * Only one timeout may exist on a context at any given time.
	 *
	 * @param maxTime maximum time in milliseconds to wait before ending the operation
	 */
	setTimeout(maxTime: number): OperationContext {
		if (this.timeout) {
			throw this.createError(`Cannot set another timeout on the operation`)
		}

		this.timeout = setTimeout(() => {
			if (this.isRunning()) {
				this.timeoutError = this.createError(
					`Operation timed out after ${maxTime}ms`,
				)
			}
		}, maxTime)
		return this
	}

	/**
	 * Sends an end signal to the operation. After this, the operation cannot
	 * be extended using `.next()`.
	 */
	end(): OperationContext {
		if (this.timeoutError) {
			throw this.timeoutError
		}
		if (!this.isRunning()) {
			throw this.createError(`Cannot end a ${this.status} operation`)
		}
		if (this.activeProcesses.length  > 0) {
			throw this.createError(`Cannot end an operation with background processes, please use .wait()`)
		}
		if (this.timeout) {
			clearTimeout(this.timeout)
		}
		this.setStatus(OperationContextStatus.ended)
		return this
	}

	/**
	 * Fails a context, and creates a context-rich error. Once an error has been
	 * created, the context cannot be extended using `.next()`.
	 * @param message the error message
	 */
	createError(message: string): OperationError {
		if (!this.endedAt) {
			this.endedAt = Date.now()
		}
		this.setStatus(OperationContextStatus.failed)
		const err = new OperationError(message, this)
		this.errors.push(err)
		return err
	}

	/**
	 * Adds a background process to the current operation. When the given promise
	 * resolves or rejects, the operation is considered complete. The success of the current
	 * operation depends on the background process.
	 * @param promise a promise returned by the background operation
	 */
	addBackgroundProcess(promise: PromiseLike<any>): OperationContext {
		const p = promise.then(() => {}, (error) => {
			this.createError(error.message || String(error))
		})
		this.activeProcesses.push(p)

		return this
	}

	/**
	 * Wait for an ending signal.
	 */
	async wait() {
		if (this.activeProcesses.length > 0) {
			await Promise.race<any>([
				Promise.all(this.activeProcesses),
				this.waitCond.wait(),
			])
		} else {
			await this.waitCond.wait()
		}

		this.waitCond.unlock()
		const firstErr = this.errors[0]
		if (firstErr) {
			throw firstErr
		}
	}

	/**
	 * Returns the full list of errors received by this operation, each with its
	 * own context and failure time.
	 */
	getErrors(): OperationError[] {
		return this.errors
	}

	/**
	 * @returns json a json-serializable object representing the context currently
	 */
	toJSON(): OperationContextJSON {
		return {
			status: this.status,
			operationID: this.id,
			trace: this.trace.map((entry) => entry.toJSON()),
			startedAt: this.startedAt,
			endedAt: this.endedAt,
		}
	}
}
