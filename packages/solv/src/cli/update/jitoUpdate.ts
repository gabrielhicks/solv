import { JITO_CONFIG } from '@/config/jitConfig'
import { spawnSync } from 'child_process'

export const jitoUpdate = (tag = JITO_CONFIG.tag, mod = false) => {
  if (mod) {
    spawnSync(`mkdir /tmp/${tag}-mod && cd /tmp/${tag}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `git clone https://github.com/gabrielhicks/jito-solana.git --recurse-submodules .`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`git checkout ${tag}-mod`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git submodule update --init --recursive`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `CI_COMMIT=$(git rev-parse HEAD) /tmp/${tag}-mod/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${tag}-mod`,
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
      `sed -i 's|^--dynamic-port-range.*$|--dynamic-port-range 8000-8025 \\|' /home/solv/start-validator.sh`,
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
  } else {
    spawnSync(`mkdir /tmp/${tag}-jito && cd /tmp/${tag}-jito`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `git clone https://github.com/jito-foundation/jito-solana.git --recurse-submodules .`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`git checkout ${tag}-jito`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git submodule update --init --recursive`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `CI_COMMIT=$(git rev-parse HEAD) /tmp/${tag}-jito/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${tag}-jito`,
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
      `sed -i 's|^--dynamic-port-range.*$|--dynamic-port-range 8000-8025 \\|' /home/solv/start-validator.sh`,
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
  }
}
