import * as uuid from 'uuid';

class OperationContextEntry {
    private readonly trace: Error;
    private readonly contextValues: Record<string, any> = {};

    constructor(private readonly context: OperationContext) {
        this.trace = new Error('-----');
    }

    next() {
        return this.context.next()
    }

    addContext(key: string, value: any): OperationContextEntry {
        this.contextValues[key] = value
        return this
    }

    addHttpRequest(request: { method: string; url: string; body: any }, response: { status: number; body: any }): OperationContextEntry {
        this.addContext('request', { method: request.method, url: request.method, body: request.body });
        this.addContext('response', { status: response.status, body: response.body })
        return this
    }

    toJSON() {
        const stacktrace = String(this.trace.stack || this.trace).split('\n');
        return {
            values: this.contextValues,
            // Remove the first line, it has an empty error message
            stacktrace: stacktrace.slice(1).map(line => line.trim()),
        };
    }
}

export class OperationContext {
    private readonly id: string = uuid.v4();
    private trace: OperationContextEntry[] = [];

    next(): OperationContextEntry {
        const entry = new OperationContextEntry(this);
        this.trace.push(entry);
        return entry;
    }

    toJSON() {
        return {
            id: this.id,
            trace: this.trace.map(entry => entry.toJSON()),
        }
    }
}
