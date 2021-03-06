export interface OperationContextEntry {
	values: Record<string, any>
	error: Error
	createdAt: number
}

export interface OperationContextEntryJSON {
	values: Record<string, any>
	stacktrace: string[]
	createdAt: number
	sinceLastEntry: number
}

export function createLongJSONFromEntry(
	entry: OperationContextEntry,
	index: number,
	entries: OperationContextEntry[],
): OperationContextEntryJSON {
	return {
		values: entry.values,
		stacktrace: String(entry.error.stack || entry.error)
			.split('\n')
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
			}),
		createdAt: entry.createdAt,
		sinceLastEntry:
			index > 0 ? entry.createdAt - entries[index - 1].createdAt : -1,
	}
}
