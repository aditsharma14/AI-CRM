// Runs `npm run typecheck` in each named package. lint-staged spawns tasks without a shell,
// and on Windows npm is npm.cmd, so the hook calls this instead of npm directly.
// Usage: node scripts/typecheck.mjs backend frontend
import { spawnSync } from 'node:child_process'

for (const pkg of process.argv.slice(2)) {
  const { status } = spawnSync('npm', ['--prefix', pkg, 'run', '-s', 'typecheck'], { stdio: 'inherit', shell: true })
  if (status !== 0) process.exit(status ?? 1)
}
