import { spawnSync } from 'child_process'

export const installBam = (version: string, mod = false, isMajorThree = false, xdp = false) => {
  if(isMajorThree) {
    if(mod) {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-bam/${version}/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      spawnSync(`mkdir /tmp/${version}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${version}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git -C /tmp/${version} clone https://github.com/jito-labs/bam-client.git --recurse-submodules .`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`git -C /tmp/${version} checkout ${version}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`git -C /tmp/${version} submodule update --init --recursive`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `CI_COMMIT=$(git -C /tmp/${version} rev-parse HEAD) /tmp/${version}/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/${version}`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `sudo rm -rf /home/solv/.local/share/solana/install/active_release`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `sudo ln -sfn /home/solv/.local/share/solana/install/releases/${version} /home/solv/.local/share/solana/install/active_release`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      if(xdp) {
        spawnSync(
          `sudo setcap cap_net_raw,cap_net_admin,cap_bpf,cap_perfmon=p /home/solv/.local/share/solana/install/active_release/bin/agave-validator`,
          {
            shell: true,
            stdio: 'inherit',
          },
        )
      }
      spawnSync(`sudo rm -rf /tmp/${version}`, {
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
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-bam/${version}/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://release.jito.wtf/${version}/install)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    }
  }
}
