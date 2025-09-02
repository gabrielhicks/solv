import { VERSION_JITO_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'

export const installJito = (version = VERSION_JITO_TESTNET, mod = false) => {
  if(mod) {
    const tag = `v${version}-mod`
    spawnSync(`mkdir /tmp/${tag} && cd /tmp/${tag}`, {
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
    spawnSync(`git checkout ${tag}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git submodule update --init --recursive`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `CI_COMMIT=$(git rev-parse HEAD) /tmp/${tag}/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${tag}`,
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
    spawnSync(`sudo rm -rf /tmp/${tag}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
  } else {
    const tag = `v${version}-jito`
    spawnSync(`mkdir /tmp/${tag} && cd /tmp/${tag}`, {
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
    spawnSync(`git checkout ${tag}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git submodule update --init --recursive`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `CI_COMMIT=$(git rev-parse HEAD) /tmp/${tag}/scripts/cargo-install-all.sh --validator-only /home/solv/.local/share/solana/install/releases/${tag}`,
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
    spawnSync(`sudo rm -rf /tmp/${tag}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo systemctl daemon-reload`, {
      shell: true,
      stdio: 'inherit',
    })
  }
}
