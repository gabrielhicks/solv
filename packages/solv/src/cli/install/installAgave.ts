import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string, mod = false) => {
  if(mod) {
    spawnSync(`mkdir /tmp/v${version}-agave-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`cd /tmp/v${version}-agave-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `git clone https://github.com/gabrielhicks/agave.git --recurse-submodules /tmp/v${version}-agave-mod`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`git -C /tmp/v${version}-agave-mod checkout v${version}-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `git -C /tmp/v${version}-agave-mod submodule update --init --recursive`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `CI_COMMIT=$(git -C /tmp/v${version}-agave-mod rev-parse HEAD) /tmp/v${version}-agave-mod/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/v${version}-agave-mod`,
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
      `cp -r /home/solv/.local/share/solana/install/releases/v${version}-agave-mod/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`sudo rm -rf /tmp/v${version}-agave-mod`, {
      shell: true,
      stdio: 'inherit',
    })
  } else {
    spawnSync(`mkdir /tmp/v${version}-agave`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`cd /tmp/v${version}-agave`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `git clone https://github.com/anza-xyz/agave.git --recurse-submodules /tmp/v${version}-agave`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`git -C /tmp/v${version}-agave checkout v${version}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git -C /tmp/v${version}-agave submodule update --init --recursive`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `CI_COMMIT=$(git -C /tmp/v${version}-agave rev-parse HEAD) /tmp/v${version}-agave/scripts/cargo-install-all.sh /home/solv/.local/share/solana/install/releases/v${version}-agave`,
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
      `cp -r /home/solv/.local/share/solana/install/releases/v${version}-agave/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`sudo rm -rf /tmp/v${version}-agave`, {
      shell: true,
      stdio: 'inherit',
    })
  }
}

export default installAgave
