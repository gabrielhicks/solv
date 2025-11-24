import { execSync } from 'child_process'
import firedancerService from './template/firedancer/firedancerService'

// This will overwrite the solv.service file with the new configuration to easily switch between testnet and mainnet
export function setupFiredancerService(): void {
  console.log('Creating solvService configuration for solana')
  const fdService = firedancerService()
  // Use sudo tee to write the file with superuser privileges
  execSync(`echo "${fdService.body}" | sudo tee ${fdService.filePath} > /dev/null`)
  console.log('frankendancer.service configuration created.')
}
