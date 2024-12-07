import { VERSION_JITO_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'

export const installJito = (version = VERSION_JITO_TESTNET) => {
  const tag = `v${version}-mod`
  spawnSync(`sh -c "$(curl -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/${tag}/installer)"`, {
    shell: true,
    stdio: 'inherit',
  })
}
