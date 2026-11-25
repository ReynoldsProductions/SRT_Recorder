import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const base = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	...base,
	{
		// Tests exercise the compiled output in dist/, which is built rather than published as source.
		files: ['test/**/*.mjs'],
		rules: { 'n/no-unpublished-import': 'off' },
	},
]
