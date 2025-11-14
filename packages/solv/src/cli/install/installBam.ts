import { VERSION_JITO_MAINNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'

export const installBam = (version = VERSION_JITO_MAINNET, mod = false, isMajorThree = false) => {
  if(isMajorThree) {
    if(mod) {
      const tag = `v${version}-mod`
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-bam/v${tag}/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      const tag = `v${version}-bam`
      spawnSync(`mkdir /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git -C /tmp/${tag} clone https://github.com/jito-labs/jito-client.git --recurse-submodules .`,
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
        `sudo ln -sfn /home/solv/.local/share/solana/install/releases/${tag}/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
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
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-bam/v${version}-mod/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://release.jito.wtf/v${version}-bam/install)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    }
  }
}
