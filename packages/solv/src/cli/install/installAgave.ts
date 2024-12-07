import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string) => {
  spawnSync(
    `sh -c "$(curl -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/v${version}-mod/installer)"`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
}

export default installAgave
