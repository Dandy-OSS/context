import { Cond } from './cond'
import * as uuid from 'uuid'
import {
	createLongJSONFromEntry,
	createShortJSONFromEntry,
	OperationContextEntryJSON,
	OperationContextEntry,
} from './entry'

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

enum OperationContextStatus {
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

export interface OperationTimer {
	end(): void
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

	private stack: OperationContextEntry[] = []
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
	 * Useful for declaring a checkpoint in your process where it is safe to exit.
	 * At the checkpoint, if the operation has exceeded its timeout or is cancelled, an
	 * error will be thrown.
	 */
	checkpoint(): OperationContext {
		if (this.timeoutError) {
			throw this.timeoutError
		}
		if (!this.isRunning()) {
			throw this.createError(
				`Operation is not running (status: ${this.status})`,
			)
		}
		return this
	}

	/**
	 * Sets one or multiple values on the current context. You can call this method
	 * multiple times with the same keys, each value will be tracked separately. Each
	 * call to this method generates a new entry on the operation stack.
	 * @param values additional values to append
	 */
	setValues(values: Record<string, any>): OperationContext {
		this.checkpoint()
		this.stack.push({ values, error: new Error(), createdAt: Date.now() })
		return this
	}

	/**
	 * Given a request, appends the key information onto the current context.
	 * @param request the http request
	 * @param response the http response
	 */
	addHttpRequest(
		request: {
			method: string
			url: string
			headers?: Record<string, string>
			body?: any
		},
		response?: {
			statusCode: number
			headers?: Record<string, string>
			body: any
		},
	): OperationContext {
		this.setValues({
			request: request ?? null,
			response: response ?? null,
		})
		return this
	}

	/**
	 * Given a response, appends the key information onto the current context.
	 * @param response the http response
	 */
	addHttpResponse(response: {
		statusCode: number
		headers?: Record<string, string>
		body: any
	}): OperationContext {
		this.setValues({
			response,
		})
		return this
	}

	/**
	 * Starts a timer for a specific event.
	 * @param name a name for the timer
	 * @returns timer a handler that allows the process that started the timer to end it
	 */
	startTimer(name: string): OperationTimer {
		const timerStartedAt = Date.now()
		return {
			end: () => {
				const duration = Date.now() - timerStartedAt
				this.setValues({ [name]: { type: 'timer', startedAt: timerStartedAt, duration } })
			},
		}
	}

	/**
	 * Sends a cancellation signal. After this point, checkpoints will fail.
	 */
	cancel(): OperationContext {
		this.checkpoint()
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
	 * Sends an end signal to the operation. After this point, checkpoints will fail.
	 */
	end(): OperationContext {
		this.checkpoint()
		if (this.activeProcesses.length > 0) {
			throw this.createError(
				`Cannot end an operation with background processes, please use .wait()`,
			)
		}
		if (this.timeout) {
			clearTimeout(this.timeout)
		}
		this.setStatus(OperationContextStatus.ended)
		return this
	}

	/**
	 * Fails a context, and creates a context-rich error. After this point, checkpoints will fail.
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
		const p = promise.then(
			() => {},
			(error) => {
				this.createError(error.message || String(error))
			},
		)
		this.activeProcesses.push(p)

		// checkpointing at the end of this function rather than the start, because
		// by the time we enter this function, a new process has been started and a
		// promise (without a .catch) now exists. it is best to add handling for that
		// before unwinding the sync stack.
		this.checkpoint()

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
			trace: this.stack.map(createLongJSONFromEntry),
			startedAt: this.startedAt,
			endedAt: this.endedAt,
		}
	}

	/**
	 * @returns json a shortened version of the `toJSON()` response (all empty entries are
	 * filtered out, and only a single stacktrace item is included)
	 */
	toShortJSON(): OperationContextJSON {
		return {
			status: this.status,
			operationID: this.id,
			trace: this.stack.map(createShortJSONFromEntry),
			startedAt: this.startedAt,
			endedAt: this.endedAt,
		}
	}
}
