import { spawnSync } from 'node:child_process'
import { existsSync } from 'fs'
import inquirer from 'inquirer'
import chalk from 'chalk'

/**
 * Uninstalls monitoring by removing telegraf and cleaning up configs
 */
export const uninstallMonitoring = async (): Promise<void> => {
  try {
    const answer = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message:
          'Are you sure you want to uninstall monitoring? This will remove telegraf and all monitoring configurations.',
        default: false,
      },
    ])

    if (!answer.confirm) {
      console.log(chalk.yellow('Uninstall cancelled'))
      return
    }

    console.log(chalk.white('🗑️  Uninstalling monitoring...'))

    // Stop and disable telegraf service
    spawnSync('sudo systemctl stop telegraf', {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo systemctl disable telegraf', {
      shell: true,
      stdio: 'inherit',
    })

    // Remove telegraf package
    const hasApt = spawnSync('which apt', { shell: true, stdio: 'pipe' })
    if (hasApt.stdout.toString().trim()) {
      spawnSync('sudo apt remove --purge telegraf -y', {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync('sudo apt autoremove -y', {
        shell: true,
        stdio: 'inherit',
      })
    }

    // Remove configuration files
    const configPaths = [
      '/etc/telegraf/telegraf.conf',
      '/etc/telegraf/telegraf.d/dz_emitter.conf',
      '/opt/doublezero/dz_metrics.py',
    ]

    for (const path of configPaths) {
      if (existsSync(path)) {
        spawnSync(`sudo rm -f ${path}`, {
          shell: true,
          stdio: 'inherit',
        })
      }
    }

    // Remove directories if empty
    const dirs = ['/etc/telegraf/telegraf.d', '/opt/doublezero']
    for (const dir of dirs) {
      if (existsSync(dir)) {
        spawnSync(`sudo rmdir ${dir} 2>/dev/null || true`, {
          shell: true,
          stdio: 'inherit',
        })
      }
    }

    console.log(chalk.green('✅ Monitoring uninstalled successfully'))
  } catch (error: any) {
    console.error(chalk.red(`❌ Error uninstalling monitoring: ${error.message}`))
    throw error
  }
}

