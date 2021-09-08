import * as uuid from 'uuid'

export class OperationError extends Error {
	constructor(message: string, readonly context: OperationContextJSON) {
		super(message)
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

	next() {
		return this.context.next()
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

	createError(message: string): OperationError {
		return new OperationError(message, this.context.toJSON())
	}

	toJSON(): OperationContextEntryJSON {
		const stacktrace = String(this.trace.stack || this.trace).split('\n')
		return {
			values: this.values,
			// Remove the first line, it has an empty error message
			stacktrace: stacktrace.slice(1).map((line) => line.trim()),
		}
	}
}

interface OperationContextJSON {
	readonly operationID: string
	readonly trace: OperationContextEntryJSON[]
}

export class OperationContext {
	private readonly id: string = uuid.v4()
	private trace: OperationContextEntry[] = []

	next(): OperationContextEntry {
		const entry = new OperationContextEntry(this)
		this.trace.push(entry)
		return entry
	}

	toJSON(): OperationContextJSON {
		return {
			operationID: this.id,
			trace: this.trace.map((entry) => entry.toJSON()),
		}
	}
}
