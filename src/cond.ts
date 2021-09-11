const kName = Symbol('kName')
const kWaiters = Symbol('kWaiters')
const kLockState = Symbol('kLockState')
const kTimer = Symbol('kTimer')

/**
 * @internal
 */
export class Cond {
	private readonly [kName]: string
	private readonly [kWaiters]: {
		resolve: () => void
		reject: (err: Error) => void
	}[]
	private [kLockState]: boolean
	private [kTimer]: NodeJS.Timeout | null

	constructor(name: string) {
		this[kName] = name
		this[kWaiters] = []
		this[kLockState] = false
		this[kTimer] = null
	}

	lock() {
		this[kLockState] = true
	}

	unlock() {
		this[kLockState] = false
		while (this[kWaiters].length) {
			this.signal()
		}
	}

	signal() {
		const waiter = this[kWaiters].shift()
		if (waiter) {
			waiter.resolve()
		}
	}

	wait() {
		const stack = new Error(`Condition variable (${this[kName]}) stalled`).stack
		return new Promise<void>((_resolve, _reject) => {
			this[kTimer] ||= setInterval(() => {
				console.warn(stack)
			}, 2 * 60e3)
			const resolve = () => {
				const timeout = this[kTimer]
				if (timeout) {
					clearInterval(timeout)
					this[kTimer] = null
				}
				_resolve()
			}
			const reject = (v: Error) => {
				const timeout = this[kTimer]
				if (timeout) {
					clearInterval(timeout)
					this[kTimer] = null
				}
				_reject(v)
			}

			if (!this[kLockState]) {
				resolve()
				return
			}

			this[kWaiters].push({
				resolve,
				reject,
			})
		})
	}
}
