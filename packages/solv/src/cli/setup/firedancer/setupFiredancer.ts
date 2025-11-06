import { VERSION_FIREDANCER, VERSION_FIREDANCER_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path';
import startFiredancerScript from './startFiredancerScript'
import firedancerService from '../template/firedancer/firedancerService'
import configToml from '../template/firedancer/configToml'
import portRelayService from '../template/firedancer/portRelayService'
import { DefaultConfigType } from '@/config/types'
import { Network } from '@/config/enums'
import { readOrCreateJitoConfig } from '@/lib/readOrCreateJitoConfig'
import { setupLogrotate } from '../setupLogrotate'
import modDiff from '../template/firedancer/mod'

const setupFiredancer = async (mod = false, config?: DefaultConfigType) => {
  const isTest = config && config.NETWORK === Network.TESTNET ? true : false
  const latestVersion = isTest ? VERSION_FIREDANCER_TESTNET : VERSION_FIREDANCER
  const {filePath: modFilePath, body: modDiffContent} = modDiff();
  if (mod) {
    spawnSync(
      `git -C /home/solv/firedancer config --global user.email "you@example.com"`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git -C /home/solv/firedancer config --global user.name "Your Name"`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(
      `git clone --recurse-submodules https://github.com/firedancer-io/firedancer.git`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(`git checkout v${latestVersion}`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    await fs.mkdir(path.dirname(modFilePath), { recursive: true });
    await fs.writeFile(modFilePath, modDiffContent, "utf8");
    spawnSync(`sudo chown solv:solv "${modFilePath}"`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`git apply ${modFilePath}`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git add .`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git commit -m "add mods"`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
  } else {
    spawnSync(
      `git clone --recurse-submodules https://github.com/firedancer-io/firedancer.git`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(`git checkout v${latestVersion}`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git submodule update --init --recursive`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
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

  spawnSync(
    `export FD_AUTO_INSTALL_PACKAGES=1 && ./deps.sh fetch check install`,
    {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    },
  )
  spawnSync(`make -j fdctl solana`, {
    shell: true,
    stdio: 'inherit',
    cwd: '/home/solv/firedancer',
  })
  spawnSync(
    `sudo ln -s /home/solv/firedancer/build/native/gcc/bin/fdctl /usr/local/bin/fdctl`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  const jitoConfig = await readOrCreateJitoConfig()
  const { filePath, body } = startFiredancerScript()
  spawnSync(`echo "${body}" | sudo tee ${filePath} > /dev/null`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo chmod +x ${filePath}`, { shell: true, stdio: 'inherit' })
  const fdService = firedancerService()
  spawnSync(
    `echo "${fdService.body}" | sudo tee ${fdService.filePath} > /dev/null`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )

  const prService = portRelayService()
  spawnSync(`sudo apt install socat`, { shell: true, stdio: 'inherit' })
  spawnSync(`sudo ufw allow 9600/tcp`, { shell: true, stdio: 'inherit' })
  spawnSync(
    `echo "${prService.body}" | sudo tee ${prService.filePath} > /dev/null`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )

  spawnSync(`sudo systemctl daemon-reload`, { shell: true })
  const toml = configToml(isTest, jitoConfig)

  await fs.writeFile(toml.filePath, toml.body, 'utf-8')

  console.log(`config.toml written to ${toml.filePath}`)
  spawnSync(`sudo chown solv:solv "${toml.filePath}"`, {
    shell: true,
    stdio: 'inherit',
  })
  setupLogrotate(true)
}

export default setupFiredancer
