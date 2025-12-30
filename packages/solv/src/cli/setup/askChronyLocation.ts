import inquirer from 'inquirer'
import { Network } from '@/config/enums'
import { readFileSync } from 'fs'
import { join } from 'path'

const MAINNET_LOCATIONS = [
  'amsterdam',
  'brazil',
  'dublin',
  'frankfurt',
  'london',
  'mexicocity',
  'newyork',
  'saltlakecity',
  'singapore',
  'southafrica',
  'tokyo',
]

export const askChronyLocation = async (isTestnet: boolean): Promise<string> => {
  if (isTestnet) {
    // For testnet, there's only one config file
    return 'testnet'
  }

  const answer = await inquirer.prompt<{ location: string }>([
    {
      name: 'location',
      type: 'list',
      message: 'Select the closest location for chrony NTP configuration',
      choices: MAINNET_LOCATIONS.map((loc) => ({
        name: loc.charAt(0).toUpperCase() + loc.slice(1).replace(/([A-Z])/g, ' $1'),
        value: loc,
      })),
    },
  ])

  return answer.location
}

export const getChronyConfigPath = (network: Network, location: string): string => {
  // Get the path to the chrony config file in the package
  // This works both in development and after bundling
  const scriptDir = __dirname
  let packageRoot: string
  
  if (scriptDir.includes('dist')) {
    // In bundled/dist environment, go up from dist/cli/setup to package root
    // When installed as npm package: node_modules/@gabrielhicks/solv/dist/cli/setup
    // Package root: node_modules/@gabrielhicks/solv
    packageRoot = join(scriptDir, '..', '..', '..')
  } else {
    // In development, go up from src/cli/setup to package root
    packageRoot = join(scriptDir, '..', '..', '..')
  }
  
  const networkDir = network === Network.MAINNET ? 'mainnet' : 'testnet'
  const configFile = network === Network.MAINNET ? `${location}.conf` : 'testnet.conf'
  
  // Try dist first (bundled), then src (development)
  const distPath = join(packageRoot, 'dist', 'cli', 'chrony', networkDir, configFile)
  const srcPath = join(packageRoot, 'src', 'cli', 'chrony', networkDir, configFile)
  
  // Check which path exists
  const fs = require('fs')
  if (fs.existsSync(distPath)) {
    return distPath
  }
  if (fs.existsSync(srcPath)) {
    return srcPath
  }
  // Fallback to dist path (for bundled packages)
  return distPath
}

export const getChronyConfigContent = (network: Network, location: string): string => {
  const configPath = getChronyConfigPath(network, location)
  try {
    return readFileSync(configPath, 'utf-8')
  } catch (error) {
    throw new Error(`Failed to read chrony config file at ${configPath}: ${error}`)
  }
}

