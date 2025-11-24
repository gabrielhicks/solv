import { spawnSync } from 'node:child_process'

export const disableSolv = () => {
  spawnSync('sudo systemctl disable solv', { shell: true, stdio: 'inherit' })
}
