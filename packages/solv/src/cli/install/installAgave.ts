import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string, mod = false, isMajorThree = false, xdp = false) => {
  if(isMajorThree) {
    if(mod) {
      spawnSync(`mkdir /tmp/${version}-agave-mod`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${version}-agave-mod`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git clone https://github.com/gabrielhicks/agave.git --recurse-submodules /tmp/${version}-agave-mod`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`git -C /tmp/${version}-agave-mod checkout ${version}-mod`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git -C /tmp/${version}-agave-mod submodule update --init --recursive`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `CI_COMMIT=$(git -C /tmp/${version}-agave-mod rev-parse HEAD) /tmp/${version}-agave-mod/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/${version}-agave-mod`,
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
        `sudo ln -sfn /home/solv/.local/share/solana/install/releases/${version}-agave-mod /home/solv/.local/share/solana/install/active_release`,
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
      spawnSync(`sudo rm -rf /tmp/${version}-agave-mod`, {
        shell: true,
        stdio: 'inherit',
      })
    } else {
      spawnSync(`mkdir /tmp/${version}-agave`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${version}-agave`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git clone https://github.com/anza-xyz/agave.git --recurse-submodules /tmp/${version}-agave`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(`git -C /tmp/${version}-agave checkout ${version}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`git -C /tmp/${version}-agave submodule update --init --recursive`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `CI_COMMIT=$(git -C /tmp/${version}-agave rev-parse HEAD) /tmp/${version}-agave/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/${version}-agave`,
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
        `sudo ln -sfn /home/solv/.local/share/solana/install/releases/${version}-agave /home/solv/.local/share/solana/install/active_release`,
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
      spawnSync(`sudo rm -rf /tmp/${version}-agave`, {
        shell: true,
        stdio: 'inherit',
      })
    }
  } else {
    if(mod) {
      spawnSync(
          `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/agave/${version}-mod/installer)"`,
          {
            shell: true,
            stdio: 'inherit',
          },
        )
    } else {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://release.anza.xyz/${version}/install)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    }
  }
}

export default installAgave
