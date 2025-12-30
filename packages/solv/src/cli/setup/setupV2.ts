import readConfig from '@/config/readConfig'
import initialConfigSetup from './question/initialConfigSetup'
import { Network, NodeType, ValidatorType } from '@/config/enums'
import setupRpcNode from './rpc'
import setupValidatorNode from './validator'
import chalk from 'chalk'
import { setupDirs } from './mkdirs'
import mountDirs from './mount/mountDirs'
import { setupPermissions } from './userPermissions'
import { makeServices } from './makeServices'
import { setupKeys } from './setupKeys'
import { daemonReload } from '@/lib/daemonReload'
import { getSnapshot } from '../get/snapshot'
import { startSolana } from '../start/startSolana'
import setupCpuGovernor from './setupCpuGovernor'
import updateSysctlConfig from '@/template/updateSysctlConfig'
import { restartLogrotate } from '@/lib/restartLogrotate'
import { enableSolv } from '@/lib/enableSolv'
import { createSymLink } from './createSymLink'
import rpcLog from '@/utils/rpcLog'
import { enableFiredancer } from '@/lib/enableFiredancer'
import { disableFiredancer } from '@/lib/disableFiredancer'
import { disableSolv } from '@/lib/disableSolv'
import { setupChrony } from './setupChrony'
import { disableAutoUpdates } from './disableAutoUpdates'
import { setupCpuFreqUtils } from './setupCpuFreqUtils'
import { setupFail2ban } from './setupFail2ban'
import { setupBbrNetwork } from './setupBbrNetwork'
export const setupV2 = async (skipInitConfig: boolean, skipMount: boolean, pivot: boolean, mod: boolean, jagSnap: boolean) => {
  try {
    if (!skipInitConfig) {
      console.log(chalk.white(`🟢 Initializing Setup`))
      // Init Config File - solv4.config.json is the new config file
      await readConfig()
      await initialConfigSetup()
    }

    let latestConfig = await readConfig()
    const isTest = latestConfig.NETWORK === Network.TESTNET
    const isFiredancer = latestConfig.VALIDATOR_TYPE === ValidatorType.FRANKENDANCER
    // Generate /mnt/ledger, /mnt/accounts and /mnt/snapshots if third disk is available
    if (!skipMount) {
      console.log(chalk.white(`🟢 Entering Mount Phase`))
      // Mount /mnt/ledger, /mnt/accounts and /mnt/snapshots if third disk is available
      setupDirs()
      await mountDirs()
    }
    // Generate Systemd Service
    makeServices(isTest, isFiredancer)
    // Restart Logrotate
    restartLogrotate()
    // Disable auto updates
    disableAutoUpdates()
    // Setup CPU governor with cpufrequtils
    setupCpuFreqUtils()
    // Set CPU governor to performance (fallback method)
    setupCpuGovernor()
    // Update Sysctl Config if needed
    await updateSysctlConfig()
    // Setup BBR network congestion control
    setupBbrNetwork()
    // Setup chrony for NTP synchronization
    if (latestConfig.CHRONY_LOCATION) {
      await setupChrony(latestConfig.NETWORK, latestConfig.CHRONY_LOCATION)
    }
    // Setup fail2ban
    setupFail2ban()
    if (!skipMount) {
      // Generate Solana Keys
      setupKeys(latestConfig)
    }
    createSymLink(latestConfig.IS_DUMMY, isTest)
    latestConfig = await readConfig()
    // Generate Soalna Startup Script
    switch (latestConfig.NODE_TYPE) {
      case NodeType.RPC:
        await setupRpcNode(latestConfig)
        break
      case NodeType.VALIDATOR:
        await setupValidatorNode(latestConfig, mod)
        break
      default:
        throw new Error('Unknown Node Type')
    }
    if(!skipMount) {
      // Setup Permissions
      setupPermissions()
    }
    // Reload Daemon
    daemonReload()
    if (latestConfig.VALIDATOR_TYPE !== ValidatorType.FRANKENDANCER) {
      if(!pivot) {
        latestConfig = await readConfig()
        // Enable Solv Service
        disableFiredancer()
        enableSolv()
        // Download Snapshot
        getSnapshot(isTest, `100`, latestConfig.SNAPSHOTS_PATH, isTest ? latestConfig.TESTNET_SOLANA_VERSION : latestConfig.MAINNET_SOLANA_VERSION)
      }
    } else {
      disableSolv()
      enableFiredancer()
      getSnapshot(isTest, `100`, latestConfig.SNAPSHOTS_PATH, isTest ? latestConfig.TESTNET_SOLANA_VERSION : latestConfig.MAINNET_SOLANA_VERSION)
    }
    if(!skipMount) {
      // Start Solana
      startSolana(latestConfig)
    }
    console.log(chalk.white(`🟢 Setup Completed`))
    rpcLog()
  } catch (error: any) {
    throw new Error(`Setup Error: ${error.message}`)
  }
}
