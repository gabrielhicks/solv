import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string, mod = false) => {
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
      `CI_COMMIT=$(git -C /tmp/${version}-agave-mod rev-parse HEAD) /tmp/${version}-agave-mod/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${version}-agave-mod`,
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
      `cp -r /home/solv/.local/share/solana/install/releases/${version}-agave-mod/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `sudo sudo sed -i '/^LimitNOFILE=1000000$/{
    n
    /^LimitMEMLOCK=infinity$/!i LimitMEMLOCK=infinity
}' /etc/systemd/system/solv.service`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `sudo sed -i 's|^--dynamic-port-range.*$|--dynamic-port-range 8000-8025 \\|' /home/solv/start-validator.sh`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`sudo rm -rf /tmp/${version}-agave-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
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
      `git clone https://github.com/anza-xyz/agave.git --recurse-submodules /tmp/${version}`,
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
      `CI_COMMIT=$(git -C /tmp/${version} rev-parse HEAD) /tmp/${version}/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${version}`,
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
      `cp -r /home/solv/.local/share/solana/install/releases/${version}/bin/ /home/solv/.local/share/solana/install/active_release/bin/`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `sudo sudo sed -i '/^LimitNOFILE=1000000$/{
    n
    /^LimitMEMLOCK=infinity$/!i LimitMEMLOCK=infinity
}' /etc/systemd/system/solv.service`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `sudo sed -i 's|^--dynamic-port-range.*$|--dynamic-port-range 8000-8025 \\|' /home/solv/start-validator.sh`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`sudo rm -rf /tmp/${version}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
  }
}

export default installAgave
