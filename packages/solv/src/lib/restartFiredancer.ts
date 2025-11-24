import { spawnSync } from 'child_process'

export const restartFiredancer = () => {
  spawnSync('sudo systemctl restart frankendancer', {
    shell: true,
    stdio: 'inherit',
  })
}
