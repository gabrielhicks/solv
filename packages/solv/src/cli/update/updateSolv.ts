import { CONFIG } from '@/config/config'
import { spawnSync } from 'child_process'

export const updateSolv = () => {
  spawnSync('pnpm self-update', { shell: true, stdio: 'inherit' })
  const nodeVersion = CONFIG.NODE_VERSION
  spawnSync(`pnpm runtime set node ${nodeVersion} -g`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync('pnpm add -g @gabrielhicks/solv@latest', {
    shell: true,
    stdio: 'inherit',
  })
}
