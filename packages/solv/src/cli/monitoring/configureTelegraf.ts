import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'fs'
import chalk from 'chalk'
import { TelegrafConfig } from './types'
import { generateTelegrafConfig } from './generateTelegrafConfig'

/**
 * Writes the telegraf configuration file
 */
export const configureTelegraf = async (
  config: TelegrafConfig,
): Promise<void> => {
  console.log(chalk.white('⚙️  Configuring telegraf...'))

  const telegrafConfigPath = '/etc/telegraf/telegraf.conf'
  const configContent = generateTelegrafConfig(config)

  // Write config to temp file first
  const tempPath = '/tmp/telegraf.conf.new'
  writeFileSync(tempPath, configContent, 'utf-8')

  // Move to final location with sudo
  spawnSync(`sudo mv ${tempPath} ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  // Set proper permissions
  spawnSync(`sudo chown root:root ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  spawnSync(`sudo chmod 644 ${telegrafConfigPath}`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Telegraf configuration written'))
}

