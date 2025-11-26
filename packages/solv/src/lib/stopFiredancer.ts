import { spawnSync } from 'node:child_process'

export const stopFiredancer = () => {
  spawnSync('sudo systemctl stop frankendancer', { shell: true, stdio: 'inherit' })
}
