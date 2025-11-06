import { VERSION_FIREDANCER, VERSION_FIREDANCER_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path';
import { DefaultConfigType } from '@/config/types'
import { Network } from '@/config/enums'
import modDiff from '../setup/template/firedancer/mod';

export const frankendancerUpdate = async (config: DefaultConfigType, version?: string, mod = false) => {
  const isTestnet = config.NETWORK === Network.TESTNET
  const firedancerVersion = version || (isTestnet ? VERSION_FIREDANCER_TESTNET : VERSION_FIREDANCER)
  const isModified = mod || config.MOD
  const {filePath: modFilePath, body: modDiffContent} = modDiff();
  // Update and restart DZ
  spawnSync(
    `sudo apt install --only-upgrade doublezero -y`,
    { shell: true, stdio: 'inherit' },
  )
  spawnSync(
    `sudo systemctl restart doublezerod`,
    { shell: true, stdio: 'inherit' },
  )
  // Update Firedancer
  if (isModified) {
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
    spawnSync(
      `git -C /home/solv/firedancer config --global user.email "you@example.com"`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git -C /home/solv/firedancer config --global user.name "Your Name"`,
      { shell: true, stdio: 'inherit' },
    )
    await fs.mkdir(path.dirname(modFilePath), { recursive: true });
    await fs.writeFile(modFilePath, modDiffContent, "utf8");
    spawnSync(`sudo chown solv:solv "${modFilePath}"`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git -C /home/solv/firedancer apply ${modFilePath}`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git -C /home/solv/firedancer add /home/solv/firedancer/src/*`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git -C /home/solv/firedancer add /home/solv/firedancer/book/*`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git -C /home/solv/firedancer commit -m "add mods"`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
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

  spawnSync(
    `sudo systemctl restart port-relay`,
    { shell: true, stdio: 'inherit' },
  )
}
