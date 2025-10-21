import { VERSION_JITO_MAINNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'

export const installJito = (version = VERSION_JITO_MAINNET, mod = false, isMajorThree = false) => {
  if(isMajorThree) {
    if(mod) {
      const tag = `v${version}-mod`
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/v${tag}/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      const tag = `v${version}-jito.1`
      spawnSync(`mkdir /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git -C /tmp/${tag} clone https://github.com/jito-foundation/jito-solana.git --recurse-submodules .`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`git -C /tmp/${tag} checkout ${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`git -C /tmp/${tag} submodule update --init --recursive`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `CI_COMMIT=$(git -C /tmp/${tag} rev-parse HEAD) /tmp/${tag}/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/${tag}`,
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
        `cp -r /home/solv/.local/share/solana/install/releases/${tag}/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`sudo rm -rf /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`sudo systemctl daemon-reload`, {
        shell: true,
        stdio: 'inherit',
      })
    }
  } else {
    if(mod) {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/v${version}-mod/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://release.jito.wtf/v${version}-jito/install)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    }
  }
}
