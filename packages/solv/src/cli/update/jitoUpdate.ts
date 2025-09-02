import { JITO_CONFIG } from '@/config/jitConfig'
import { spawnSync } from 'child_process'

export const jitoUpdate = (tag = JITO_CONFIG.tag, mod = false) => {
  if (mod) {
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
      `CI_COMMIT=$(git -C /tmp/${tag}-mod rev-parse HEAD) /tmp/${tag}-mod/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${tag}-mod`,
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
    spawnSync(`sudo rm -rf /tmp/${tag}-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`solv get snapshot`, {
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
      `CI_COMMIT=$(git -C /tmp/${tag}-jito rev-parse HEAD) /tmp/${tag}-jito/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${tag}-jito`,
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
    spawnSync(`sudo rm -rf /tmp/${tag}-jito`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`solv get snapshot`, {
      shell: true,
      stdio: 'inherit',
    })
  }
}
