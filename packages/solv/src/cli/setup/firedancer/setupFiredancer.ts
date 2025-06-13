import { VERSION_FIREDANCER, VERSION_FIREDANCER_TESTNET, VERSION_MAINNET, VERSION_TESTNET } from '@/config/versionConfig'
import { spawnSync } from 'child_process'
import { promises as fs } from 'fs'
import startFiredancerScript from './startFiredancerScript'
import firedancerService from '../template/firedancer/firedancerService'
import configToml from '../template/firedancer/configToml'
import portRelayService from '../template/firedancer/portRelayService'
import { DefaultConfigType } from '@/config/types'
import { Network } from '@/config/enums'
import { readOrCreateJitoConfig } from '@/lib/readOrCreateJitoConfig'
import { setupLogrotate } from '../setupLogrotate'

const setupFiredancer = async (mod = false, config?: DefaultConfigType) => {
  const isTest = config && config.NETWORK === Network.TESTNET ? true : false
  const latestVersion = isTest ? VERSION_FIREDANCER_TESTNET : VERSION_FIREDANCER
  const latestSubmoduleVersion = isTest ? VERSION_TESTNET : VERSION_MAINNET
  
  if (mod) {
    spawnSync(
      `git clone --recurse-submodules https://github.com/gabrielhicks/firedancer.git`,
      { shell: true, stdio: 'inherit' },
    )
    spawnSync(`git checkout v${latestVersion}-mod`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer',
    })
    spawnSync(`git checkout v${latestSubmoduleVersion}-mod`, {
      shell: true,
      stdio: 'inherit',
      cwd: '/home/solv/firedancer/agave',
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
  }
  spawnSync(`./deps.sh`, {
    shell: true,
    stdio: 'inherit',
    cwd: '/home/solv/firedancer',
  })
  spawnSync(`make -j fdctl`, {
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
  console.log('JITO Validator Setup for Mainnet')
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
  setupLogrotate(true);
}

export default setupFiredancer
