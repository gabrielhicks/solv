import { homedir } from 'os'

/**
 * Ensure every binary solv invokes by bare name is resolvable in spawned
 * children, regardless of how the invoking shell sourced its profile. Covers:
 *   - Solana CLI    (solana, solana-keygen, agave-validator, ...)
 *   - pnpm global   (pnpm itself, plus any pnpm-installed global CLIs)
 *
 * pnpm in particular refuses to install global packages if its configured
 * "global-bin-dir" isn't in PATH — even when pnpm itself is reachable. We
 * defensively prepend the canonical install locations so that's never a
 * problem for child processes solv spawns with `shell: true`.
 */
export const ensureRuntimePath = (): void => {
  const binDirs = [
    // Solana CLI (Anza / Agave installer puts binaries here).
    `${homedir()}/.local/share/solana/install/active_release/bin`,
    '/home/solv/.local/share/solana/install/active_release/bin',
    // pnpm v11+ layout: $PNPM_HOME/bin
    `${homedir()}/.local/share/pnpm/bin`,
    '/home/solv/.local/share/pnpm/bin',
    // Older pnpm layout: $PNPM_HOME directly
    `${homedir()}/.local/share/pnpm`,
    '/home/solv/.local/share/pnpm',
  ]
  const parts = (process.env.PATH ?? '').split(':').filter(Boolean)
  const missing = binDirs.filter((dir) => !parts.includes(dir))
  if (missing.length > 0) {
    process.env.PATH = [...missing, ...parts].join(':')
  }
}
