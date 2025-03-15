import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string, mod = false) => {
  if(mod) {
    spawnSync(
      `sh -c "$(curl -sSfL https://raw.githubusercontent.com/gabrielhicks/agave/v${version}-mod/installer)"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
  } else {
    spawnSync(
      `sh -c "$(curl -sSfL https://release.anza.xyz/v${version}/install)"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
  }
}

export default installAgave
