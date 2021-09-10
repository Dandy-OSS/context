<h1 align="center">
  context
</h1>

<p align="center">Maintain meaningful context across async processes.</p>

<p align="center">
  <a href="https://github.com/Dandy-OSS/context/actions">
    <img src="https://github.com/Dandy-OSS/context/workflows/CI/badge.svg" alt="Build Status">
  </a>
</p>

```
npm install @orthly/context
```

**Table of Contents**

 * [Documentation](https://orthly-context.vercel.app)
 * [Examples](#examples)
 * [License](#license)

## Examples

The purpose of this library is to manage a "context" object across several operations (usually async) and to maintain all context that is needed for debugging.
This can be useful for better monitoring, measuring performance, and general troubleshooting. There's a few interesting things you can do with this:

**Adding values for debugging**

```javascript
const operation = new OperationContext()

function oneMethod(ctx, a, b) {
  ctx.setValue('a', a).setValue('b', b)
  return a + b
}

function anotherMethod(ctx, a, b) {
  ctx.setValue('a', a).setValue('b', b)
  return oneMethod(ctx.next(), a, b)
}

anotherMethod(operation.next(), 1, 1)
```

**Create timed operations**

All operations can be assigned a maximum time that they have to complete. If this time elapses and the operation has not been explicitly ended, it will be forcefully
ended. After an operation has timed out, `operation.isRunning()` will evaluate to `false` and `ctx.next()` will automatically error out. As a result, you can either
let a high-level error handler catch the timeout, or explicitly avoid further work by checking if the operation is active.

```javascript
const opertaion = new OperationContext()
operation.setTimeout(1_000)

function smartOperation(ctx) {
  if (!ctx.isRunning()) {
    // avoid further work / do cleanup here
    throw ctx.createError('Operation timed out')
  }
  expensiveOperations()
}

function dumbOperation(ctx) {
  return furtherOp(ctx.next()) // this will automatically fail with a timeout message
}

smartOperation(operation.next())
dumbOperation(operation.next())
```

**Storing the context for debugging**

The context is made to be JSON-serializable (`operation.toJSON()`) so you can report it to Sentry, or store it in your database. It will contain an ID for the overall operation and then separate entries for each time a sub-context was created. Each context entry contains a synchronous stack trace and the context values appended to it.

```javascript
const opertaion = new OperationContext()
operation.next().next().next()
operation.toJSON()
/**
 * {
 *   operationID: '....',
 *   trace: [
 *     { values: {}, stacktrace: ['at index.js:1:1'] },
 *     ...
 *   ]
 * }
 */
```

## License

Copyright &copy; Orthly Inc 2021-present.

Licensed under MIT.
