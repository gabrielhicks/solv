import { spawnSync } from 'node:child_process'

export const disableFiredancer = () => {
  spawnSync('sudo systemctl disable frankendancer', { shell: true, stdio: 'inherit' })
}
