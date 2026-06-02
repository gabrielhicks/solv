import getSolvVersion from '@/cli/epochTimer/getSolvVersion'
import getNpmLatestVersion from '@/cli/epochTimer/getNpmLatestVersion'
import {
  getAllKeyPaths,
  NODE_RESTART_REQUIRED_MAINNET,
  NODE_RESTART_REQUIRED_TESTNET,
  FD_RESTART_REQUIRED_MAINNET,
  FD_RESTART_REQUIRED_TESTNET,
  BAM_RESTART_REQUIRED_TESTNET,
  BAM_RESTART_REQUIRED_MAINNET,
} from '@/config/config'
import { sendDiscord } from '@/lib/sendDiscord'
import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import waitCatchup from './waitCatchup'
import { getSolanaAddress } from '@/lib/getSolanaAddress'
import sleep from '@/lib/sleep'
import { DefaultConfigType } from '@/config/types'
import { Network, ValidatorType } from '@/config/enums'

// File where we record the last version we pinged Discord about, so we don't
// spam the channel every epoch when a node is stuck or unchanged.
const LAST_PINGED_VERSION_FILE = join(homedir(), '.solv-last-pinged-version')

const readLastPingedVersion = (): string | null => {
  try {
    if (existsSync(LAST_PINGED_VERSION_FILE)) {
      return readFileSync(LAST_PINGED_VERSION_FILE, 'utf8').trim() || null
    }
  } catch {}
  return null
}

const writeLastPingedVersion = (v: string): void => {
  try {
    writeFileSync(LAST_PINGED_VERSION_FILE, v, 'utf8')
  } catch {}
}

// NODE_RESTART_REQUIRED_MAINNET/TESTNET is a boolean
// This is a global variable that is not defined in this file
// It is defined in packages/solv/src/cli/config/config.ts
// Please DO NOT forget to turn this to false if it's not needed

const autoUpdate = async (config: DefaultConfigType) => {
  const isMainnet = config.NETWORK === Network.MAINNET
  const isFrankendancer = config.VALIDATOR_TYPE === ValidatorType.FRANKENDANCER
  const isBam = config.VALIDATOR_TYPE === ValidatorType.BAM
  const { mainnetValidatorKey, testnetValidatorKey } = getAllKeyPaths()
  const validatorKey = isMainnet ? mainnetValidatorKey : testnetValidatorKey
  // const solanaVersion = getSolanaVersion()
  
  // Notify the user about the update
  let isUpdateRequired = false
  if (isFrankendancer) {
    isUpdateRequired = isMainnet
      ? FD_RESTART_REQUIRED_MAINNET
      : FD_RESTART_REQUIRED_TESTNET
  } else if (isBam) {
    isUpdateRequired = isMainnet
      ? BAM_RESTART_REQUIRED_MAINNET
      : BAM_RESTART_REQUIRED_TESTNET
  } else {
    isUpdateRequired = isMainnet
      ? NODE_RESTART_REQUIRED_MAINNET
      : NODE_RESTART_REQUIRED_TESTNET
  }
  isUpdateRequired = isUpdateRequired && config.AUTO_RESTART

  const address = getSolanaAddress(validatorKey)
  const currentVersion = getSolvVersion()
  const latestVersion = await getNpmLatestVersion()
  const lastPinged = readLastPingedVersion()

  // Only ping Discord when the situation actually changed since the last ping
  // (success or failure). This prevents the channel from getting spammed every
  // epoch when a node is stuck and the `solv update` chain is silently no-op-ing.
  // We key the "state" by both the version and whether it's a success/failure,
  // so transitioning stuck-state -> updated -> stuck-state still pings each time.
  const pingState = latestVersion
    ? currentVersion === latestVersion
      ? `ok:${currentVersion}`
      : `stuck:${currentVersion}->${latestVersion}`
    : `unknown:${currentVersion}`

  if (pingState !== lastPinged) {
    let msg: string
    if (!latestVersion) {
      msg = `**${address}** ran auto-update — registry lookup failed; on **${currentVersion}**`
    } else if (currentVersion === latestVersion) {
      msg = `**${address}** updated solv to **${currentVersion}**`
    } else {
      msg = `⚠️ **${address}** failed to auto-update — still on **${currentVersion}** (latest is **${latestVersion}**)`
    }
    await sendDiscord(msg)
    writeLastPingedVersion(pingState)
  }

  if (isUpdateRequired) {
    // Restart the node
    const msg = `Restarting **${address}**\n` + `_ _`
    await sendDiscord(msg)
    try {
      spawnSync(`solv update && solv update --config && solv update --startup && sudo systemctl daemon-reload && solv update -b`, {
        stdio: 'inherit',
        shell: true,
      })
    } catch (error: any) {
      const errorMsg = `Error restarting **${address}**: ${error?.message || 'Unknown error'}`
      await sendDiscord(errorMsg)
      return false
    }
    const timestampRestart = Math.floor(Date.now() / 1000)
    const restartMsg = `**${address}** has restarted, catching up...\n` + `at: <t:${timestampRestart}> (${timestampRestart})\n` + `_ _`
    await sendDiscord(restartMsg)
    await sleep(180 * 1000)
    
    // Wait for the node to catch up
    const catchup = await waitCatchup(config)
    if (catchup) {
      // epoch seconds when catchup completes
      const timestampCatchup = Math.floor(Date.now() / 1000)

      const diffSeconds = timestampCatchup - timestampRestart
      const minutes = Math.floor(diffSeconds / 60)
      const seconds = diffSeconds % 60
      const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
      const msg = `**${address}** has caught up!\n` + `at: <t:${timestampRestart}> (${timestampRestart})\n` + `**${address}** took **${durationStr}** to catch up after restart!\n` + `_ _`
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
