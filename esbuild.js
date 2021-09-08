const path = require('path')
const { build } = require('esbuild')

const buildFile = (input, output) =>
	build({
		entryPoints: [input],
		outfile: output,
		bundle: true,
		platform: 'node',
		target: 'node14',
		plugins: [
			{
				name: 'make-all-packages-external',
				setup(build) {
					let filter = /^[^./]|^\.[^./]|^\.\.[^/]/
					build.onResolve({ filter }, (args) => ({
						path: args.path,
						external: true,
					}))
				},
			},
		],
		watch: process.argv.includes('-w'),
	})

buildFile(`./src/index.ts`, `./dist/index.js`).catch((error) => {
	if (!error.errors) {
		console.error(error)
	}
	process.exit(1)
})
