import { OperationContext, OperationError } from '../index'
import { describe, it, expect } from '@jest/globals'

describe('OperationContext', () => {
	it('should track context separately', () => {
		function multiply(ctx: OperationContext, a: number, b: number): number {
			ctx.setValues({ op: 'mul', a, b })
			return a * b
		}
		function pow(ctx: OperationContext, a: number, b: number): number {
			ctx.setValues({ op: 'pow', a, b })
			if (b === 0) {
				return 1
			}
			return multiply(ctx, a, pow(ctx, a, b - 1))
		}

		const ctx = new OperationContext()
		expect(pow(ctx, 2, 6)).toEqual(64)
		expect(ctx.toJSON().trace.map((entry) => entry.values))
			.toMatchInlineSnapshot(`
		Array [
		  Object {
		    "a": 2,
		    "b": 6,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 5,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 4,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 3,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 2,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 1,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 0,
		    "op": "pow",
		  },
		  Object {
		    "a": 2,
		    "b": 1,
		    "op": "mul",
		  },
		  Object {
		    "a": 2,
		    "b": 2,
		    "op": "mul",
		  },
		  Object {
		    "a": 2,
		    "b": 4,
		    "op": "mul",
		  },
		  Object {
		    "a": 2,
		    "b": 8,
		    "op": "mul",
		  },
		  Object {
		    "a": 2,
		    "b": 16,
		    "op": "mul",
		  },
		  Object {
		    "a": 2,
		    "b": 32,
		    "op": "mul",
		  },
		]
	`)
	})
	it('should not allow entries after cancellation', () => {
		const ctx = new OperationContext()
		ctx.setValues({ a: 1 })
		ctx.setValues({ a: 1 })
		ctx.cancel()
		expect(() => ctx.setValues({ a: 1 })).toThrow()
		expect(() => ctx.cancel()).toThrow()
		expect(() => ctx.end()).toThrow()
		expect(ctx.toJSON().trace.length).toEqual(2)
		expect(ctx.isRunning()).toEqual(false)
	})
	it('should timeout automatically', async () => {
		const ctx = new OperationContext()
		ctx.setTimeout(1_000)
		ctx.setValues({ a: 1 })
		await expect(ctx.wait()).rejects.toThrow()
		expect(() => ctx.setValues({ a: 1 })).toThrow()
		expect(() => ctx.cancel()).toThrow()
		expect(() => ctx.end()).toThrow()
		expect(ctx.toJSON().trace.length).toEqual(1)
		expect(ctx.isRunning()).toEqual(false)
	})
	it('should throw valuable errors on timeout', async () => {
		const ctx = new OperationContext()
		ctx.setTimeout(1_000)
		ctx.setValues({ a: 1 })
		await new Promise((resolve) => setTimeout(resolve, 1_000))

		let error: OperationError
		try {
			ctx.setValues({ a: 1 })
		} catch (err) {
			error = err as OperationError
		}

		expect(error!).toBeDefined()
		expect(error!.context).toBeDefined()
		expect(error!.context.toJSON().trace.length).toEqual(1)
		expect(String(error!)).toMatch(/timed out/)
	})
	it('should filter out internal stacktrace items', () => {
		function testFunction(ctx: OperationContext) {
			ctx.setValues({ a: 1 })
		}
		function firstFunction(ctx: OperationContext) {
			ctx.setValues({ a: 1 })
			testFunction(ctx)
		}

		const ctx = new OperationContext()
		firstFunction(ctx)
		ctx.end()

		const { trace } = ctx.toJSON()
		expect(trace).toHaveLength(2)
		expect(trace[0].stacktrace[0]).toContain('firstFunction')
	})
	it('should wait for background processes to complete', async () => {
		async function bgProcess(ctx: OperationContext) {
			await Promise.resolve()
			ctx.setValues({ hello: 'world' })
		}

		const ctx = new OperationContext()
		ctx.addBackgroundProcess(bgProcess(ctx))
		await ctx.wait()

		expect(ctx.toJSON().trace[0].values).toEqual({ hello: 'world' })
	})
	it('should error when background processes fail', async () => {
		async function bgProcess(ctx: OperationContext) {
			ctx.setValues({ a: 1 })
			throw new Error('testing bg failure')
		}

		const ctx = new OperationContext()
		ctx.addBackgroundProcess(bgProcess(ctx))
		await expect(ctx.wait()).rejects.toThrow(/testing bg failure/)
	})
	it('should produce shortened json', () => {
		const ctx = new OperationContext()
		ctx.setValues({ a: 1 })
		ctx.end()

		expect(ctx.toJSON().trace[0].stacktrace.length).toBeGreaterThan(1)
		expect(ctx.toShortJSON().trace[0].stacktrace).toHaveLength(1)
	})
})
