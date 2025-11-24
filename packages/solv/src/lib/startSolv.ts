import { spawnSync } from 'node:child_process'

export const startSolv = () => {
  spawnSync('sudo systemctl start solv', { shell: true, stdio: 'inherit' })
}
