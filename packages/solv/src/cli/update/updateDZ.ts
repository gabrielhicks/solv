import { spawnSync } from 'node:child_process'

const updateDZ = (version: string, isTestnet: boolean) => {
  if (isTestnet) {
    spawnSync(`sudo apt-get install doublezero=${version} -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl restart doublezerod`, {
      shell: true,
      stdio: 'inherit',
    })
  } else {
    spawnSync(`sudo apt-get install doublezero=${version} -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl restart doublezerod`, {
      shell: true,
      stdio: 'inherit',
    })
  }
}

export default updateDZ
