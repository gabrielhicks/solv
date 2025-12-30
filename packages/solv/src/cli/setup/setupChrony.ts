import { spawnSync } from 'child_process'
import chalk from 'chalk'
import { Network } from '@/config/enums'
import { getChronyConfigContent } from './askChronyLocation'
import { writeFileSync } from 'fs'

export const setupChrony = async (network: Network, location: string) => {
  try {
    console.log(chalk.white('⏰ Setting up chrony...'))

    // Stop and disable systemd-timesyncd
    console.log(chalk.gray('Stopping systemd-timesyncd...'))
    spawnSync('sudo systemctl stop systemd-timesyncd', {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo systemctl disable systemd-timesyncd', {
      shell: true,
      stdio: 'inherit',
    })

    // Update apt and install chrony
    console.log(chalk.gray('Updating package list...'))
    spawnSync('sudo apt update', {
      shell: true,
      stdio: 'inherit',
    })

    console.log(chalk.gray('Installing chrony...'))
    const installResult = spawnSync('sudo apt install chrony -y', {
      shell: true,
      stdio: 'inherit',
    })

    if (installResult.status !== 0) {
      throw new Error('Failed to install chrony')
    }

    // Get the chrony config content
    const configContent = getChronyConfigContent(network, location)

    // Remove existing chrony.conf and create new one
    console.log(chalk.gray('Configuring chrony...'))
    spawnSync('sudo rm -f /etc/chrony/chrony.conf', {
      shell: true,
      stdio: 'inherit',
    })

    // Write the config file
    const tempConfigPath = '/tmp/chrony.conf'
    writeFileSync(tempConfigPath, configContent, 'utf-8')
    spawnSync(`sudo mv ${tempConfigPath} /etc/chrony/chrony.conf`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo chmod 644 /etc/chrony/chrony.conf', {
      shell: true,
      stdio: 'inherit',
    })

    // Enable and start chrony
    console.log(chalk.gray('Enabling and starting chrony service...'))
    spawnSync('sudo systemctl enable chrony', {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo systemctl restart chrony', {
      shell: true,
      stdio: 'inherit',
    })

    // Verify chrony is working
    console.log(chalk.gray('Verifying chrony sources...'))
    spawnSync('chronyc sources -v', {
      shell: true,
      stdio: 'inherit',
    })

    // Update netplan to disable DNS search and maas
    console.log(chalk.gray('Updating netplan configuration...'))
    const netplanFile = '/etc/netplan/50-cloud-init.yaml'
    if (spawnSync(`test -f ${netplanFile}`, { shell: true }).status === 0) {
      spawnSync(`sudo sed -i 's/^\\(\\s*search:\\)/#\\1/g' ${netplanFile}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync(`sudo sed -i 's/^\\(\\s*.*maas.*\\)/#\\1/g' ${netplanFile}`, {
        shell: true,
        stdio: 'inherit',
      })
      spawnSync('sudo netplan apply', {
        shell: true,
        stdio: 'inherit',
      })
    }

    console.log(chalk.green('✅ Chrony setup completed'))
    console.log(chalk.gray('You can check chrony status with:'))
    console.log(chalk.gray('  chronyc tracking'))
    console.log(chalk.gray('  chronyc sourcestats -v'))
  } catch (error: any) {
    throw new Error(`Failed to setup chrony: ${error.message}`)
  }
}

