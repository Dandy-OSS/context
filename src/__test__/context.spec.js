import { describe, it, expect } from '@jest/globals'
import { OperationContext } from '../index'

describe('OperationContext', () => {
	it('should track context separately', () => {
		function multiply(ctx, a, b) {
			ctx.setValue('a', a).setValue('b', b)
			return a * b
		}
		function pow(ctx, a, b) {
			ctx.setValue('a', a).setValue('b', b)
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
	expect(operation.toJSON().id).toBeDefined()
})
