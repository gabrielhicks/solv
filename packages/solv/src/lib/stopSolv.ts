import { spawnSync } from 'node:child_process'

export const stopSolv = () => {
  spawnSync('sudo systemctl stop solv', { shell: true, stdio: 'inherit' })
}
