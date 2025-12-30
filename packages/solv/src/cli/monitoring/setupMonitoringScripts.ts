import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'fs'
import chalk from 'chalk'

/**
 * Sets up the monitoring Python scripts from sv-manager
 * Downloads and installs all necessary Python files and creates the virtual environment
 */
export const setupMonitoringScripts = async (
  user: string,
  cluster: 'mainnet-beta' | 'testnet',
  validatorName: string,
): Promise<void> => {
  console.log(chalk.white('🐍 Setting up monitoring Python scripts...'))

  const homeDir = `/home/${user}`
  const monitoringDir = `${homeDir}/monitoring`
  const binDir = `${monitoringDir}/bin`
  const scriptsDir = `${monitoringDir}/scripts`

  // Create directories
  if (!existsSync(monitoringDir)) {
    spawnSync(`sudo mkdir -p ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  if (!existsSync(scriptsDir)) {
    spawnSync(`sudo mkdir -p ${scriptsDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Create Python virtual environment if it doesn't exist
  if (!existsSync(binDir)) {
    console.log(chalk.white('Creating Python virtual environment...'))
    spawnSync(`sudo -u ${user} python3 -m venv ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Install required Python packages
  console.log(chalk.white('Installing Python dependencies...'))
  const requirements = `numpy>=1.21.0
requests>=2.25.0`
  
  const requirementsPath = '/tmp/monitoring_requirements.txt'
  writeFileSync(requirementsPath, requirements, 'utf-8')
  
  spawnSync(
    `sudo -u ${user} ${binDir}/pip install -q -r ${requirementsPath}`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )

  // Download monitoring scripts from sv-manager
  const scripts = [
    'common.py',
    'solana_rpc.py',
    'request_utils.py',
    'measurement_validator_info.py',
    'output_validator_measurements.py',
  ]

  const baseUrl = 'https://raw.githubusercontent.com/mfactory-lab/sv-manager/main/roles/monitoring/files'

  for (const script of scripts) {
    console.log(chalk.white(`Downloading ${script}...`))
    const scriptPath = `${scriptsDir}/${script}`
    const downloadResult = spawnSync(
      `curl -fsSL ${baseUrl}/${script} -o ${scriptPath}`,
      {
        shell: true,
        stdio: 'pipe',
      },
    )

    if (downloadResult.status !== 0) {
      throw new Error(`Failed to download ${script}`)
    }

    // Set ownership
    spawnSync(`sudo chown ${user}:${user} ${scriptPath}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Create monitoring_config.py
  const monitoringConfig = `from common import ValidatorConfig

config = ValidatorConfig(
    validator_name="${validatorName}",
    secrets_path="${homeDir}/.secrets",
    local_rpc_address="http://localhost:8899",
    remote_rpc_address="https://api.${cluster}.solana.com",
    cluster_environment="${cluster}",
    debug_mode=False
)
`

  const configPath = `${scriptsDir}/monitoring_config.py`
  writeFileSync(configPath, monitoringConfig, 'utf-8')
  spawnSync(`sudo chown ${user}:${user} ${configPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  // Create output_starter.sh
  const outputStarter = `#!/bin/bash
source "${monitoringDir}/bin/activate"
result=$(timeout -k 50 45 python3 "${scriptsDir}/$1.py")

if [ -z "$result" ]
then
        echo "{}"
else
        echo "$result"
fi
`

  const starterPath = `${monitoringDir}/output_starter.sh`
  writeFileSync(starterPath, outputStarter, 'utf-8')
  spawnSync(`sudo chmod +x ${starterPath}`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo chown ${user}:${user} ${starterPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Monitoring scripts setup complete'))
}

