import { spawnSync } from 'node:child_process'
import chalk from 'chalk'
import { DefaultConfigType } from '@/config/types'
import { Network } from '@/config/enums'
import { installTelegraf } from './installTelegraf'
import { setupValidatorKeys } from './setupValidatorKeys'
import { configureTelegraf } from './configureTelegraf'
import { setupDoublezero } from './setupDoublezero'
import { restartMonitoring } from './restartMonitoring'
import { setupMonitoringScripts } from './setupMonitoringScripts'
import { setupSudoers } from './setupSudoers'
import { TelegrafConfig, MonitoringConfig } from './types'
import { KEYPAIRS, HOME_PATHS } from '@/config/config'

/**
 * Main installation function that orchestrates all monitoring setup steps
 */
export const installMonitoring = async (
  config: DefaultConfigType,
  options: Partial<MonitoringConfig>,
): Promise<void> => {
  try {
    console.log(chalk.cyan('📊 Starting Monitoring Installation'))
    console.log(
      chalk.yellow(
        '⚠️  This will install and configure telegraf for monitoring',
      ),
    )

    // Determine cluster from config
    const cluster: 'mainnet-beta' | 'testnet' = 
      (options.cluster as any) || 
      (config.NETWORK === Network.TESTNET ? 'testnet' : 'mainnet-beta')

    // Get hostname as default validator name
    const hostnameResult = spawnSync('hostname', {
      shell: true,
      stdio: 'pipe',
      encoding: 'utf-8',
    })
    const defaultValidatorName = hostnameResult.stdout.toString().trim() || `validator-${cluster}`
    const validatorName = options.validatorName || defaultValidatorName

    // Use default solv user and key locations
    const user = options.user || 'solv'
    const isTestnet = cluster === 'testnet'
    
    // Determine key paths based on cluster
    const validatorKeyName = 'identity.json'
    const voteKeyName = isTestnet
      ? KEYPAIRS.TESTNET_VALIDATOR_VOTE_KEY
      : KEYPAIRS.MAINNET_VALIDATOR_VOTE_KEY
    
    const validatorKeyPath = `${HOME_PATHS.ROOT}/${validatorKeyName}`
    const voteKeyPath = `${HOME_PATHS.ROOT}/${voteKeyName}`
    const keysPath = HOME_PATHS.ROOT // Keys are in /home/solv/

    const skipDoublezero = options.skipDoublezero || false

    // Step 1: Install telegraf
    await installTelegraf()

    // Step 2: Setup monitoring Python scripts
    await setupMonitoringScripts(user, cluster, validatorName)

    // Step 3: Configure sudoers for telegraf
    await setupSudoers(user)

    // Step 4: Setup validator key symlinks
    await setupValidatorKeys(user, validatorKeyPath, voteKeyPath)

    // Step 5: Configure telegraf
    const telegrafConfig: TelegrafConfig = {
      hostname: validatorName,
      flushInterval: '30s',
      interval: '30s',
      mountPoints: ['/', '/mnt/ledger', '/mnt/accounts', '/mnt/snapshots'],
      validatorUser: user,
      validatorKeysPath: keysPath,
      cluster,
      influxdbVMetrics: {
        database: 'v_metrics',
        urls: ['http://influx.thevalidators.io:8086'],
        username: 'v_user',
        password: 'thepassword',
      },
    }

    // Add doublezero metrics if not skipped
    if (!skipDoublezero) {
      telegrafConfig.influxdbDzMetrics = {
        database: 'dz_metrics',
        urls: ['https://influxdb.apps.ra.latentfree.llc'],
        username: 'dz_user',
        password: '1b91CP@44b3c',
      }
    }

    await configureTelegraf(telegrafConfig)

    // Step 6: Setup doublezero monitoring if not skipped
    if (!skipDoublezero) {
      await setupDoublezero()
    }

    // Step 7: Restart telegraf service
    await restartMonitoring()

    console.log(chalk.green('\n✅ Monitoring installation complete!'))
    console.log(
      chalk.cyan(
        `📊 Check your dashboard: https://solana.thevalidators.io/d/e-8yEOXMwerfwe/solana-monitoring?&var-server=${validatorName}`,
      ),
    )
  } catch (error: any) {
    console.error(chalk.red(`❌ Error installing monitoring: ${error.message}`))
    throw error
  }
}

