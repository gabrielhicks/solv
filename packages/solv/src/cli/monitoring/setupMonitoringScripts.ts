import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync, readFileSync } from 'fs'
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

  // Check and install python3-venv if needed
  const venvCheck = spawnSync('python3 -m venv --help', {
    shell: true,
    stdio: 'pipe',
  })
  
  if (venvCheck.status !== 0) {
    console.log(chalk.white('Installing python3-venv package...'))
    const hasApt = spawnSync('which apt', { shell: true, stdio: 'pipe' })
    if (hasApt.stdout.toString().trim()) {
      // Detect Python version
      const pythonVersion = spawnSync('python3 --version', {
        shell: true,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).stdout.toString().match(/Python (\d+\.\d+)/)?.[1] || '3'
      
      const venvPackage = `python${pythonVersion}-venv`
      const installResult = spawnSync(`sudo apt install -y ${venvPackage}`, {
        shell: true,
        stdio: 'inherit',
      })
      
      if (installResult.status !== 0) {
        throw new Error(`Failed to install ${venvPackage}. Please install it manually: sudo apt install ${venvPackage}`)
      }
    } else {
      throw new Error('python3-venv is not available. Please install it manually.')
    }
  }

  // Clean up any existing failed venv directory
  if (existsSync(monitoringDir) && !existsSync(`${binDir}/pip`)) {
    console.log(chalk.yellow('Cleaning up incomplete virtual environment...'))
    spawnSync(`sudo rm -rf ${monitoringDir}`, {
      shell: true,
      stdio: 'inherit',
    })
  }

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
  if (!existsSync(binDir) || !existsSync(`${binDir}/pip`)) {
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
      throw new Error('Failed to create Python virtual environment. Make sure python3-venv is installed.')
    }
  }

  // Verify venv was created successfully
  if (!existsSync(`${binDir}/pip`)) {
    throw new Error('Python virtual environment was not created successfully. The pip binary is missing.')
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
  // When bundled, import.meta.url points to the bundled file location
  // We need to find the scripts relative to the package root
  let localScriptsDir: string | null = null
  
  // Get the directory of the current module file
  const currentFile = fileURLToPath(import.meta.url)
  let searchDir = dirname(currentFile)
  
  // Search up the directory tree to find the package root (where package.json or dist/cli exists)
  // When bundled, we're at node_modules/@gabrielhicks/solv/dist/index.js
  // Scripts are at node_modules/@gabrielhicks/solv/dist/cli/monitoring/scripts
  for (let i = 0; i < 15; i++) {
    // Try dist/cli/monitoring/scripts (production/installed)
    const distScriptsPath = join(searchDir, 'cli', 'monitoring', 'scripts')
    if (existsSync(distScriptsPath)) {
      localScriptsDir = distScriptsPath
      break
    }
    
    // Try src/cli/monitoring/scripts (development)
    const srcScriptsPath = join(searchDir, 'src', 'cli', 'monitoring', 'scripts')
    if (existsSync(srcScriptsPath)) {
      localScriptsDir = srcScriptsPath
      break
    }
    
    // Try direct scripts (if copied to same level)
    const directScriptsPath = join(searchDir, 'scripts')
    if (existsSync(directScriptsPath) && existsSync(join(directScriptsPath, 'common.py'))) {
      localScriptsDir = directScriptsPath
      break
    }
    
    // Move up one directory
    const parentDir = dirname(searchDir)
    if (parentDir === searchDir) break // Reached filesystem root
    searchDir = parentDir
  }
  
  // Fallback: try process.cwd() locations (for development)
  if (!localScriptsDir) {
    const cwdDistPath = join(process.cwd(), 'dist', 'cli', 'monitoring', 'scripts')
    if (existsSync(cwdDistPath)) {
      localScriptsDir = cwdDistPath
    } else {
      const cwdSrcPath = join(process.cwd(), 'src', 'cli', 'monitoring', 'scripts')
      if (existsSync(cwdSrcPath)) {
        localScriptsDir = cwdSrcPath
      }
    }
  }

  if (!localScriptsDir) {
    console.error(chalk.red(`Could not locate monitoring scripts directory.`))
    console.error(chalk.red(`Searched from: ${fileURLToPath(import.meta.url)}`))
    console.error(chalk.red(`Current working directory: ${process.cwd()}`))
    throw new Error('Could not find monitoring scripts directory. Please ensure the package is built correctly and scripts are included in the dist folder.')
  }
  
  console.log(chalk.white(`Using scripts from: ${localScriptsDir}`))

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
  // Escape $ to avoid template string interpolation - need literal ${result} in bash script
  const outputStarter = `#!/bin/bash
source "${monitoringDir}/bin/activate"
result=$(timeout -k 50 45 python3 "${scriptsDir}/$1.py")

if [ -z "$` + '{result}' + `" ]
then
        echo "{}"
else
        echo "$` + '{result}' + `"
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

