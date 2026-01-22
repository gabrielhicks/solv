import { spawnSync } from 'node:child_process'

// Agave Install e.g. installAgave('0.1.0')
const installAgave = (version: string) => {
  spawnSync(`mkdir /tmp/${version}-agave`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`cd /tmp/${version}-agave`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(
    `git -C /tmp/${version}-agave clone https://github.com/anza-xyz/agave.git --recurse-submodules .`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(`git -C /tmp/${version}-agave checkout ${version}`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(
    `git -C /tmp/${version}-agave submodule update --init --recursive`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
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
  spawnSync(`sudo rm -rf /tmp/${version}-agave`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo systemctl daemon-reload`, {
    shell: true,
    stdio: 'inherit',
  })
}

export default installAgave
