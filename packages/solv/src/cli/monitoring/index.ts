import { program } from '@/index'
import { DefaultConfigType } from '@/config/types'
import { installMonitoring } from './installMonitoring'
import { uninstallMonitoring } from './uninstallMonitoring'
import { restartMonitoring } from './restartMonitoring'
import { statusMonitoring } from './statusMonitoring'

export const monitoringCommands = (config: DefaultConfigType) => {
  const monitoring = program
    .command('monitoring')
    .alias('mon')
    .description('Monitoring Setup and Management Commands')

  monitoring
    .command('install')
    .alias('i')
    .description('Install and configure monitoring (telegraf + influxdb)')
    .option('--cluster <cluster>', 'Cluster: mainnet-beta or testnet (defaults to config)')
    .option('--validator-name <name>', 'Validator name for monitoring (defaults to hostname)')
    .option('--skip-doublezero', 'Skip doublezero monitoring setup', false)
    .action(async (options: {
      cluster?: 'mainnet-beta' | 'testnet'
      validatorName?: string
      skipDoublezero: boolean
    }) => {
      await installMonitoring(config, options)
    })

  monitoring
    .command('uninstall')
    .alias('u')
    .description('Uninstall monitoring (removes telegraf and configs)')
    .action(async () => {
      await uninstallMonitoring()
    })

  monitoring
    .command('restart')
    .alias('r')
    .description('Restart telegraf service')
    .action(async () => {
      await restartMonitoring()
    })

  monitoring
    .command('status')
    .alias('s')
    .description('Show monitoring status')
    .action(async () => {
      await statusMonitoring()
    })
}

