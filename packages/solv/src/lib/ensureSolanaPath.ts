import { homedir } from 'os'

/**
 * Ensure the Solana CLI bin directory is on PATH for every child process solv
 * spawns (solana-keygen, agave-validator, etc.). Many solv commands invoke
 * these by bare name with `shell: true`, so they must be resolvable regardless
 * of how the invoking shell sourced its profile (login vs non-login, etc.).
 *
 * The Anza/Agave installer places the binaries under
 * ~/.local/share/solana/install/active_release/bin.
 */
export const ensureSolanaPath = (): void => {
  const binDirs = [
    `${homedir()}/.local/share/solana/install/active_release/bin`,
    '/home/solv/.local/share/solana/install/active_release/bin',
  ]
  const parts = (process.env.PATH ?? '').split(':').filter(Boolean)
  const missing = binDirs.filter((dir) => !parts.includes(dir))
  if (missing.length > 0) {
    process.env.PATH = [...missing, ...parts].join(':')
  }
}
