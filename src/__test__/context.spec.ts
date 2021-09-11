import { describe, it, expect } from '@jest/globals'
import {
	OperationContext,
	OperationContextEntry,
	OperationError,
} from '../index'

describe('OperationContext', () => {
	it('should track context separately', () => {
		function multiply(
			ctx: OperationContextEntry,
			a: number,
			b: number,
		): number {
			ctx.setValues({ a, b })
			return a * b
		}
		function pow(ctx: OperationContextEntry, a: number, b: number): number {
			ctx.setValues({ a, b })
			if (b === 0) {
				return 1
			}
			return multiply(ctx.next(), a, pow(ctx.next(), a, b - 1))
		}

		const operation = new OperationContext()
		expect(pow(operation.next(), 2, 3)).toEqual(8)
		expect(operation.toJSON().trace.map((entry) => entry.values))
			.toMatchInlineSnapshot(`
		Array [
		  Object {
		    "a": 2,
		    "b": 3,
		  },
		  Object {
		    "a": 2,
		    "b": 4,
		  },
		  Object {
		    "a": 2,
		    "b": 2,
		  },
		  Object {
		    "a": 2,
		    "b": 2,
		  },
		  Object {
		    "a": 2,
		    "b": 1,
		  },
		  Object {
		    "a": 2,
		    "b": 1,
		  },
		  Object {
		    "a": 2,
		    "b": 0,
		  },
		]
	`)
	})
	it('should not allow entries after cancellation', () => {
		const op = new OperationContext()
		op.next()
		op.next()
		op.cancel()
		expect(() => op.next()).toThrow()
		expect(() => op.cancel()).toThrow()
		expect(() => op.end()).toThrow()
		expect(op.toJSON().trace.length).toEqual(2)
		expect(op.isRunning()).toEqual(false)
	})
	it('should timeout automatically', async () => {
		const op = new OperationContext()
		op.setTimeout(1_000)
		op.next()
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		expect(() => op.next()).toThrow()
		expect(() => op.cancel()).toThrow()
		expect(() => op.end()).toThrow()
		expect(op.toJSON().trace.length).toEqual(1)
		expect(op.isRunning()).toEqual(false)
	})
	it('should throw valuable errors on timeout', async () => {
		const op = new OperationContext()
		op.setTimeout(1_000)
		op.next()
		await new Promise((resolve) => setTimeout(resolve, 1_000))

		let error: OperationError
		try {
			op.next()
		} catch (err) {
			error = err as OperationError
		}

		expect(error!).toBeDefined()
		expect(error!.context).toBeDefined()
		expect(error!.context.toJSON().trace.length).toEqual(1)
		expect(String(error!)).toMatch(/timed out/)
	})
})
