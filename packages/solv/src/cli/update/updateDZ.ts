import { spawnSync } from 'node:child_process'

const updateDZ = (version: string, isTestnet: boolean) => {
  if (isTestnet) {
    spawnSync(`sudo apt update -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt install --upgrade-only doublezero=${version} -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt update -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt install doublezero-solana -y`, {
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
    spawnSync(`sudo apt update -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt install --upgrade-only doublezero=${version} -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt update -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt install doublezero-solana -y`, {
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
