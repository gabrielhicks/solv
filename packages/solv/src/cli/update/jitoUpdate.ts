import { JITO_CONFIG } from '@/config/jitConfig'
import { spawnSync } from 'child_process'

export const jitoUpdate = (tag = JITO_CONFIG.tag, mod = false, isMajorThree = false) => {
  if (isMajorThree) {
    if (mod) {
      spawnSync(`mkdir /tmp/${tag}-mod`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${tag}-mod`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git clone https://github.com/gabrielhicks/jito-solana.git --recurse-submodules /tmp/${tag}-mod`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`git -C /tmp/${tag}-mod checkout ${tag}-mod`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`git -C /tmp/${tag}-mod submodule update --init --recursive`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `CI_COMMIT=$(git -C /tmp/${tag}-mod rev-parse HEAD) /tmp/${tag}-mod/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/${tag}-mod`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `sudo rm -rf /home/solv/.local/share/solana/install/active_release/bin/`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `cp -r /home/solv/.local/share/solana/install/releases/${tag}-mod/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`sudo rm -rf /tmp/${tag}-mod`, {
        shell: true,
        stdio: 'inherit',
      })
    } else {
      spawnSync(`mkdir /tmp/${tag}-jito`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${tag}-jito`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git clone https://github.com/jito-foundation/jito-solana.git --recurse-submodules /tmp/${tag}-jito`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`git -C /tmp/${tag}-jito checkout ${tag}-jito`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`git -C /tmp/${tag}-jito submodule update --init --recursive`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `CI_COMMIT=$(git -C /tmp/${tag}-jito rev-parse HEAD) /tmp/${tag}-jito/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/${tag}-jito`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `sudo rm -rf /home/solv/.local/share/solana/install/active_release/bin/`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `cp -r /home/solv/.local/share/solana/install/releases/${tag}-jito/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`sudo rm -rf /tmp/${tag}-jito`, {
        shell: true,
        stdio: 'inherit',
      })
    }
  } else {
    if(mod) {
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
}
