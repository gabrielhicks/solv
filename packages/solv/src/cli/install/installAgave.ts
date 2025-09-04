import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string, mod = false) => {
  if(mod) {
    spawnSync(`sudo apt-get update`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt-get install -y libclang-18-dev clang-18 llvm-18-dev`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `grep -qxF 'export LIBCLANG_PATH=/usr/lib/llvm-18/lib' /home/solv/.profile || echo 'export LIBCLANG_PATH=/usr/lib/llvm-18/lib' >> /home/solv/.profile`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `grep -qxF 'export CLANG_PATH=/usr/bin/clang-18' /home/solv/.profile || echo 'export CLANG_PATH=/usr/bin/clang-18' >> /home/solv/.profile`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(`source /home/solv/.profile`, { shell: true, stdio: 'inherit' })
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
      `CI_COMMIT=$(git -C /tmp/v${version}-agave-mod rev-parse HEAD) /tmp/v${version}-agave-mod/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/v${version}-agave-mod`,
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
      "sudo sed -i 's|^--dynamic-port-range.*$|--dynamic-port-range 8000-8025 \\\\|' /home/solv/start-validator.sh",
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`sudo rm -rf /tmp/v${version}-agave-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
  } else {
    spawnSync(`sudo apt-get update`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt-get install -y libclang-18-dev clang-18 llvm-18-dev`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `grep -qxF 'export LIBCLANG_PATH=/usr/lib/llvm-18/lib' /home/solv/.profile || echo 'export LIBCLANG_PATH=/usr/lib/llvm-18/lib' >> /home/solv/.profile`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `grep -qxF 'export CLANG_PATH=/usr/bin/clang-18' /home/solv/.profile || echo 'export CLANG_PATH=/usr/bin/clang-18' >> /home/solv/.profile`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(`source /home/solv/.profile`, { shell: true, stdio: 'inherit' })
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
      `CI_COMMIT=$(git -C /tmp/v${version}-agave rev-parse HEAD) /tmp/v${version}-agave/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/v${version}-agave`,
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
    "sudo sed -i 's|^--dynamic-port-range.*$|--dynamic-port-range 8000-8025 \\\\|' /home/solv/start-validator.sh",
    {
      shell: true,
      stdio: 'inherit',
    },
  )

    spawnSync(`sudo rm -rf /tmp/v${version}-agave`, {
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
