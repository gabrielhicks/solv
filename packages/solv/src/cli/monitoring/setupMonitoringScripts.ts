import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, readFileSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
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

  // Create directories with proper ownership
  if (!existsSync(monitoringDir)) {
    spawnSync(`sudo mkdir -p ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo chown -R ${user}:${user} ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  if (!existsSync(scriptsDir)) {
    spawnSync(`sudo mkdir -p ${scriptsDir}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo chown -R ${user}:${user} ${scriptsDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

  // Create Python virtual environment if it doesn't exist
  if (!existsSync(binDir)) {
    console.log(chalk.white('Creating Python virtual environment...'))
    // Ensure directory is owned by user before creating venv
    spawnSync(`sudo chown -R ${user}:${user} ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
    const venvResult = spawnSync(`sudo -u ${user} python3 -m venv ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
    if (venvResult.status !== 0) {
      throw new Error('Failed to create Python virtual environment')
    }
  }

  // Verify venv was created successfully
  if (!existsSync(`${binDir}/pip`)) {
    throw new Error('Python virtual environment was not created successfully')
  }

  // Install required Python packages
  console.log(chalk.white('Installing Python dependencies...'))
  const requirements = `numpy>=1.21.0
requests>=2.25.0`
  
  const requirementsPath = '/tmp/monitoring_requirements.txt'
  writeFileSync(requirementsPath, requirements, 'utf-8')
  
  const pipResult = spawnSync(
    `sudo -u ${user} ${binDir}/pip install -q -r ${requirementsPath}`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )

  if (pipResult.status !== 0) {
    throw new Error('Failed to install Python dependencies')
  }

  // Copy monitoring scripts from local package
  const scripts = [
    'common.py',
    'solana_rpc.py',
    'request_utils.py',
    'measurement_validator_info.py',
    'output_validator_measurements.py',
  ]

  // Get the path to the local scripts directory
  // Try multiple locations: dist (production), src (development), or relative to current file
  let localScriptsDir: string | null = null
  
  // Try dist location first (production build)
  const distScriptsPath = join(process.cwd(), 'dist', 'cli', 'monitoring', 'scripts')
  if (existsSync(distScriptsPath)) {
    localScriptsDir = distScriptsPath
  } else {
    // Try src location (development)
    const srcScriptsPath = join(process.cwd(), 'src', 'cli', 'monitoring', 'scripts')
    if (existsSync(srcScriptsPath)) {
      localScriptsDir = srcScriptsPath
    } else {
      // Try relative to current file (when running from node_modules)
      const currentFile = fileURLToPath(import.meta.url)
      const currentDir = dirname(currentFile)
      const relativeScriptsPath = join(currentDir, 'scripts')
      if (existsSync(relativeScriptsPath)) {
        localScriptsDir = relativeScriptsPath
      }
    }
  }

  if (!localScriptsDir) {
    throw new Error('Could not find monitoring scripts directory. Please ensure the package is built correctly.')
  }

  for (const script of scripts) {
    console.log(chalk.white(`Copying ${script}...`))
    const localScriptPath = join(localScriptsDir, script)
    const targetScriptPath = `${scriptsDir}/${script}`
    const tempPath = `/tmp/${script}`

    // Check if local script exists
    if (!existsSync(localScriptPath)) {
      throw new Error(`Local script not found: ${localScriptPath}`)
    }

    // Read local file and write to temp
    const scriptContent = readFileSync(localScriptPath, 'utf-8')
    writeFileSync(tempPath, scriptContent, 'utf-8')

    // Move to final location and set ownership
    spawnSync(`sudo mv ${tempPath} ${targetScriptPath}`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo chown ${user}:${user} ${targetScriptPath}`, {
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

