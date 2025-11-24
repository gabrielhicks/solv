import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installSolana = (version: string) => {
  spawnSync(
    `sh -c "$(curl --netrc-optional -sSfL https://release.solana.com/${version}/install)"`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(`sudo systemctl disable frankendancer.service`, {
    stdio: 'inherit',
    shell: true,
  })
  spawnSync(`sudo systemctl stop frankendancer.service`, {
    stdio: 'inherit',
    shell: true,
  })
}

export default installSolana
