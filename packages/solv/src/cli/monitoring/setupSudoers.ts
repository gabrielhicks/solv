import { spawnSync } from 'node:child_process'
import { existsSync } from 'fs'
import chalk from 'chalk'

/**
 * Configures sudoers to allow telegraf user to run commands as the validator user without password
 */
export const setupSudoers = async (validatorUser: string): Promise<void> => {
  console.log(chalk.white('🔐 Configuring sudoers for telegraf...'))

  const sudoersFile = '/etc/sudoers.d/telegraf-monitoring'
  const sudoersRule = `telegraf ALL=(${validatorUser}) NOPASSWD: /home/${validatorUser}/monitoring/output_starter.sh\n`

  // Check if rule already exists
  if (existsSync(sudoersFile)) {
    const existingContent = spawnSync(`sudo cat ${sudoersFile}`, {
      shell: true,
      stdio: 'pipe',
      encoding: 'utf-8',
    }).stdout.toString()

    if (existingContent.includes(`telegraf ALL=(${validatorUser}) NOPASSWD:`)) {
      console.log(chalk.yellow('⚠️  Sudoers rule already exists, skipping'))
      return
    }
  }

  // Write sudoers rule
  const tempSudoersFile = '/tmp/telegraf-monitoring-sudoers'
  spawnSync(`echo '${sudoersRule}' | sudo tee ${tempSudoersFile} > /dev/null`, {
    shell: true,
    stdio: 'inherit',
  })

  // Validate sudoers syntax before moving
  const validateResult = spawnSync(`sudo visudo -c -f ${tempSudoersFile}`, {
    shell: true,
    stdio: 'pipe',
  })

  if (validateResult.status !== 0) {
    throw new Error('Invalid sudoers syntax. Aborting.')
  }

  // Move to final location with proper permissions
  spawnSync(`sudo mv ${tempSudoersFile} ${sudoersFile}`, {
    shell: true,
    stdio: 'inherit',
  })

  spawnSync(`sudo chmod 440 ${sudoersFile}`, {
    shell: true,
    stdio: 'inherit',
  })

  console.log(chalk.green('✅ Sudoers configured for telegraf'))
}

