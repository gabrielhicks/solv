import { spawnSync } from 'node:child_process'

export const enableFiredancer = () => {
  spawnSync('sudo systemctl enable frankendancer', { shell: true, stdio: 'inherit' })
}
