import { neostandard, resolveIgnoresFromGitignore } from 'neostandard'

export default neostandard({
  env: ['node', 'vitest'],
  globalIgnores: [...resolveIgnoresFromGitignore()],
  noJsx: true,
  noStyle: true
})
