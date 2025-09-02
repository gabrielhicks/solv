import getSolvVersion from '@/cli/epochTimer/getSolvVersion'
import {
  getAllKeyPaths,
  NODE_RESTART_REQUIRED_MAINNET,
  NODE_RESTART_REQUIRED_TESTNET,
  FD_RESTART_REQUIRED_MAINNET,
  FD_RESTART_REQUIRED_TESTNET,
} from '@/config/config'
import { sendDiscord } from '@/lib/sendDiscord'
import { spawnSync } from 'child_process'
import waitCatchup from './waitCatchup'
import { getSolanaAddress } from '@/lib/getSolanaAddress'
import sleep from '@/lib/sleep'
import { DefaultConfigType } from '@/config/types'
import { Network, ValidatorType } from '@/config/enums'
import getSolanaVersion from '@/cli/epochTimer/getSolanaVersion'

// NODE_RESTART_REQUIRED_MAINNET/TESTNET is a boolean
// This is a global variable that is not defined in this file
// It is defined in packages/solv/src/cli/config/config.ts
// Please DO NOT forget to turn this to false if it's not needed

const autoUpdate = async (config: DefaultConfigType) => {
  const isMainnet = config.NETWORK === Network.MAINNET
  const isFrankendancer = config.VALIDATOR_TYPE === ValidatorType.FRANKENDANCER
  const { mainnetValidatorKey, testnetValidatorKey } = getAllKeyPaths()
  const validatorKey = isMainnet ? mainnetValidatorKey : testnetValidatorKey
  // const solanaVersion = getSolanaVersion()
  
  // Notify the user about the update
  let isUpdateRequired = false
  if (isFrankendancer) {
    isUpdateRequired = isMainnet
      ? FD_RESTART_REQUIRED_MAINNET
      : FD_RESTART_REQUIRED_TESTNET
  } else {
    isUpdateRequired = isMainnet
      ? NODE_RESTART_REQUIRED_MAINNET
      : NODE_RESTART_REQUIRED_TESTNET
  }
  isUpdateRequired = isUpdateRequired && config.AUTO_RESTART

  const address = getSolanaAddress(validatorKey)
  const msg = `**${address}** updated solv to **${getSolvVersion()}**`
  await sendDiscord(msg)

  if (isUpdateRequired) {
    // Restart the node
    const msg = `Restarting **${address}**`
    await sendDiscord(msg)
    try {
      spawnSync(`solv update && solv update --config && solv update -b`, {
        stdio: 'inherit',
        shell: true,
      })
    } catch (error: any) {
      const errorMsg = `Error restarting **${address}**: ${error?.message || 'Unknown error'}`
      await sendDiscord(errorMsg)
      return false
    }

    const restartMsg = `**${address}** has restarted, catching up...`
    await sendDiscord(restartMsg)
    await sleep(180 * 1000)
    
    // Wait for the node to catch up
    const catchup = await waitCatchup(config)
    if (catchup) {
      const msg = `**${address}** has caught up!`
      await sendDiscord(msg)
    } else {
      const errorMsg = `**${address}** failed to catch up after update`
      await sendDiscord(errorMsg)
    }
    return catchup
  }
  return true
}

export default autoUpdate
