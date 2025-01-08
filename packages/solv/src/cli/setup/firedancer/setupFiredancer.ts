import { VERSION_FIREDANCER } from '@/config/versionConfig'
import { spawnSync } from 'child_process'
import startFiredancerScript from './startFiredancerScript'
import firedancerService from '../template/firedancer/firedancerService'
import configToml from '../template/firedancer/configToml'
import portRelayService from '../template/firedancer/portRelayService'

const setupFiredancer = async () => {
  spawnSync(
    `git clone --recurse-submodules https://github.com/gabrielhicks/firedancer.git`,
    { shell: true, stdio: 'inherit' },
  )
  spawnSync(`git checkout v${VERSION_FIREDANCER}-mod`, {
    shell: true,
    stdio: 'inherit',
    cwd: '/home/solv/firedancer',
  })
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
  const toml = configToml()
  spawnSync(`sudo tee ${toml.filePath} > /dev/null`, {
    input: toml.body,
    shell: true,
    stdio: 'inherit',
  })
}

export default setupFiredancer
