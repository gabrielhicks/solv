import { spawnSync } from 'node:child_process'
import { existsSync } from 'fs'
import chalk from 'chalk'

/**
 * Shows the status of monitoring services
 */
export const statusMonitoring = async (): Promise<void> => {
  console.log(chalk.cyan('📊 Monitoring Status\n'))

  // Check if telegraf is installed
  const telegrafInstalled = spawnSync('which telegraf', {
    shell: true,
    stdio: 'pipe',
  })

  if (telegrafInstalled.status !== 0) {
    console.log(chalk.red('❌ Telegraf is not installed'))
    return
  }

  console.log(chalk.green('✅ Telegraf is installed'))

  // Check telegraf service status
  const serviceStatus = spawnSync('sudo systemctl is-active telegraf', {
    shell: true,
    stdio: 'pipe',
  })

  const isActive = serviceStatus.stdout.toString().trim() === 'active'
  if (isActive) {
    console.log(chalk.green('✅ Telegraf service is running'))
  } else {
    console.log(chalk.yellow('⚠️  Telegraf service is not running'))
  }

  // Check configuration files
  const configPath = '/etc/telegraf/telegraf.conf'
  if (existsSync(configPath)) {
    console.log(chalk.green(`✅ Telegraf config exists: ${configPath}`))
  } else {
    console.log(chalk.red(`❌ Telegraf config not found: ${configPath}`))
  }

  // Check doublezero setup
  const dzScript = '/opt/doublezero/dz_metrics.py'
  const dzConfig = '/etc/telegraf/telegraf.d/dz_emitter.conf'
  if (existsSync(dzScript) && existsSync(dzConfig)) {
    console.log(chalk.green('✅ Doublezero monitoring is configured'))
  } else {
    console.log(chalk.yellow('⚠️  Doublezero monitoring is not configured'))
  }

  // Show service status details
  console.log(chalk.cyan('\n📋 Service Details:'))
  spawnSync('sudo systemctl status telegraf --no-pager -l', {
    shell: true,
    stdio: 'inherit',
  })
}

