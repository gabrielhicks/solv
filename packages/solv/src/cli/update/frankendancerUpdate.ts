import { JITO_CONFIG } from '@/config/jitConfig'
import { spawnSync } from 'child_process'

export const frankendancerUpdate = (tag = JITO_CONFIG.tag, mod = false) => {
  if (mod) {
    spawnSync(
      `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/${tag}-mod/installer)"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
  } else {
    spawnSync(
      `sh -c "$(curl --netrc-optional -sSfL https://release.jito.wtf/${tag}-jito/install)"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
  }
}
