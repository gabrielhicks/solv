import { spawnSync } from 'node:child_process'
import chalk from 'chalk'

/**
 * Restarts the telegraf service
 */
export const restartMonitoring = async (): Promise<void> => {
  console.log(chalk.white('🔄 Restarting telegraf service...'))

  spawnSync('sudo systemctl daemon-reload', {
    shell: true,
    stdio: 'inherit',
  })

  const result = spawnSync('sudo systemctl restart telegraf.service', {
    shell: true,
    stdio: 'inherit',
  })

  if (result.status === 0) {
    console.log(chalk.green('✅ Telegraf service restarted successfully'))
  } else {
    throw new Error('Failed to restart telegraf service')
  }
}

