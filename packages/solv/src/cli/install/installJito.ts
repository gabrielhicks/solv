import { VERSION_JITO_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'

export const installJito = (version = VERSION_JITO_TESTNET, mod = false) => {
  if(mod) {
    const tag = `v${version}-mod`
    spawnSync(
      `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/${tag}/installer)"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
  } else {
    const tag = `v${version}-jito`
    spawnSync(
      `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/jito-foundation/jito-solana/${tag}/installer)"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
  }
}
