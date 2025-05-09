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
import setupFiredancer from './firedancer/setupFiredancer'

export const setupV2 = async (skipInitConfig = false, skipMount = false, pivot = false, mod = false) => {
  try {
    if (!skipInitConfig) {
      console.log(chalk.white(`🟢 Initializing Setup`))
      // Init Config File - solv4.config.json is the new config file
      await readConfig()
      await initialConfigSetup()
    }

    let latestConfig = await readConfig()
    const isTest = latestConfig.NETWORK === Network.TESTNET
    // Generate /mnt/ledger, /mnt/accounts and /mnt/snapshots if third disk is available
    setupDirs()
    if (!skipMount || !pivot) {
      // Mount /mnt/ledger, /mnt/accounts and /mnt/snapshots if third disk is available
      await mountDirs()
    }

    // Generate Systemd Service
    makeServices(isTest)
    // Restart Logrotate
    restartLogrotate()
    // Set CPU governor to performance
    setupCpuGovernor()
    // Update Sysctl Config if needed
    await updateSysctlConfig()
    // Generate Solana Keys
    setupKeys(latestConfig)
    createSymLink(latestConfig.IS_DUMMY, isTest)
    latestConfig = await readConfig()
    // Generate Soalna Startup Script
    switch (latestConfig.NODE_TYPE) {
      case NodeType.RPC:
        await setupRpcNode(latestConfig)
        break
      case NodeType.VALIDATOR:
        await setupValidatorNode(latestConfig, mod)
        // Setup Firedancer if needed
        if (latestConfig.VALIDATOR_TYPE === ValidatorType.FRANKENDANCER) {
          await setupFiredancer(mod, latestConfig)
        }
        break
      default:
        throw new Error('Unknown Node Type')
    }
    if(!pivot) {
      // Setup Permissions
      setupPermissions()
    }
    // Reload Daemon
    daemonReload()
    if (latestConfig.VALIDATOR_TYPE !== ValidatorType.FRANKENDANCER) {
      if(!pivot) {
        latestConfig = await readConfig()
        // Enable Solv Service
        enableSolv()
        // Download Snapshot
        getSnapshot(isTest, `100`, latestConfig.SNAPSHOTS_PATH, isTest ? latestConfig.TESTNET_SOLANA_VERSION : latestConfig.MAINNET_SOLANA_VERSION)
      }
    }
    if(!pivot) {
      // Start Solana
      startSolana(latestConfig)
    }
    console.log(chalk.white(`🟢 Setup Completed`))
    rpcLog()
  } catch (error: any) {
    throw new Error(`Setup Error: ${error.message}`)
  }
}
