import { VERSION_FIREDANCER, VERSION_FIREDANCER_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'
import { DefaultConfigType } from '@/config/types'
import { Network } from '@/config/enums'

export const frankendancerUpdate = async (config: DefaultConfigType, version?: string, mod = false) => {
  const isTestnet = config.NETWORK === Network.TESTNET
  const firedancerVersion = version || (isTestnet ? VERSION_FIREDANCER_TESTNET : VERSION_FIREDANCER)
  const isModified = mod || config.MOD

  // Update Firedancer
  if (isModified) {
    spawnSync(
      `git -C /home/solv/firedancer fetch origin`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git -C /home/solv/firedancer checkout v${firedancerVersion}-mod`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git -C /home/solv/firedancer submodule update --init --recursive`,
      { shell: true, stdio: 'inherit' },
    )
  } else {
    spawnSync(
      `git -C /home/solv/firedancer fetch origin`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git -C /home/solv/firedancer checkout v${firedancerVersion}`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git -C /home/solv/firedancer submodule update --init --recursive`,
      { shell: true, stdio: 'inherit' },
    )
  }
  

  // Temp rust bug
  // spawnSync(`rustup uninstall 1.84.1-x86_64-unknown-linux-gnu`, {
  //   shell: true,
  //   stdio: 'inherit',
  //   cwd: '/home/solv/firedancer',
  // })
  // spawnSync(`rustup install 1.84.1`, {
  //   shell: true,
  //   stdio: 'inherit',
  //   cwd: '/home/solv/firedancer',
  // })

  // Rebuild Firedancer
  spawnSync(
    `export FD_AUTO_INSTALL_PACKAGES=1 && ./deps.sh fetch check install`,
    {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    },
  )
  spawnSync(
    `make -j fdctl solana`,
    {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    },
  )

  // Restart services
  spawnSync(
    `sudo systemctl restart frankendancer`,
    { shell: true, stdio: 'inherit' },
  )
  spawnSync(`sudo rm -rf /mnt/accounts/snapshot`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(
    `sudo systemctl restart port-relay`,
    { shell: true, stdio: 'inherit' },
  )
}
