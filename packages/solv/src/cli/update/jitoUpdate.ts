import { spawnSync } from 'child_process'

export const jitoUpdate = (tag: string, mod = false, isMajorThree = false, xdp = false) => {
  // Update DZ
  spawnSync(
    `sudo apt install --only-upgrade doublezero doublezero-solana -y`,
    { shell: true, stdio: 'inherit' },
  )
  spawnSync(
    `sudo systemctl restart doublezerod`,
    { shell: true, stdio: 'inherit' },
  )
  if (isMajorThree) {
    if (mod) {
      spawnSync(
        `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/${tag}/installer)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    } else {
      spawnSync(`mkdir /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`cd /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(
        `git clone https://github.com/jito-foundation/jito-solana.git --recurse-submodules /tmp/${tag}`,
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
        `sudo rm -rf /home/solv/.local/share/solana/install/active_release`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      spawnSync(
        `sudo ln -sfn /home/solv/.local/share/solana/install/releases/${tag} /home/solv/.local/share/solana/install/active_release`,
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
      spawnSync(`sudo rm -rf /tmp/${tag}`, {
        shell: true,
        stdio: 'inherit',
      })
    }
  } else {
    if(mod) {
      spawnSync(
          `sh -c "$(curl --netrc-optional -sSfL https://raw.githubusercontent.com/gabrielhicks/jito-solana/${tag}/installer)"`,
          {
            shell: true,
            stdio: 'inherit',
          },
        )
    } else {
      spawnSync(
         `sh -c "$(curl --netrc-optional -sSfL https://release.jito.wtf/${tag}/install)"`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
    }
  }
}
