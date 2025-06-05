import { program } from '@/index'
import { spawnSync } from 'node:child_process'
import chalk from 'chalk'
import { DefaultConfigType } from '@/config/types'
import getSolanaCLI from '@/config/getSolanaCLI'
import { Network } from '@/config/enums'

export const restartCommand = (config: DefaultConfigType) => {
  let solanaValidatorClient = getSolanaCLI()
  program
    .command('restart')
    .description('Restart Solana Validator')
    .option('-r, --rm', 'Remove Snapshot and Restart Validator', false)
    .action(async (options: { rm: boolean }) => {
      const isAutoRestart = config.AUTO_RESTART
      const isTestnet = config.NETWORK === Network.TESTNET
      const minIdleTime = isAutoRestart && isTestnet ? 10 : 30
      if (options.rm) {
        console.log(
          chalk.white('👷‍♀️ Removing Snapshot and Restarting Validator...'),
        )
        spawnSync('solv stop', { stdio: 'inherit', shell: true })
        spawnSync('solv rm:snapshot', { stdio: 'inherit', shell: true })
        spawnSync('solv get snapshot', { stdio: 'inherit', shell: true })
        spawnSync('solv start', { stdio: 'inherit', shell: true })
        console.log(chalk.green('✔︎ Successfully Restarted Validator'))
        process.exit(0)
      }
      const cmd = `${solanaValidatorClient} --ledger ${config.LEDGER_PATH} exit --max-delinquent-stake ${config.MAINNET_DELINQUENT_STAKE} --min-idle-time ${minIdleTime}`
      spawnSync(cmd, { shell: true, stdio: 'inherit' })
      process.exit(0)
    })
}
