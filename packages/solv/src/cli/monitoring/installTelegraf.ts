import { spawnSync } from 'node:child_process'
import chalk from 'chalk'

/**
 * Installs telegraf and sets up the influxdata repository
 * This replaces the ansible playbook installation step
 */
export const installTelegraf = async (): Promise<void> => {
  console.log(chalk.white('📦 Installing telegraf...'))

  // Detect package manager
  const hasApt = spawnSync('which apt', { shell: true, stdio: 'pipe' })
  const hasYum = spawnSync('which yum', { shell: true, stdio: 'pipe' })

  if (hasApt.stdout.toString().trim()) {
    // Ubuntu/Debian setup
    console.log(chalk.white('Detected apt package manager'))

    // Remove old GPG key if exists
    spawnSync('sudo rm -f /etc/apt/trusted.gpg', {
      shell: true,
      stdio: 'inherit',
    })

    // Create keyrings directory
    spawnSync('sudo mkdir -p /etc/apt/keyrings', {
      shell: true,
      stdio: 'inherit',
    })

    // Add influxdata repository key
    spawnSync(
      'curl -fsSL https://repos.influxdata.com/influxdata-archive_compat.key | sudo tee /etc/apt/keyrings/influxdata-archive_compat.asc > /dev/null',
      {
        shell: true,
        stdio: 'inherit',
      },
    )

    // Verify key was added
    const keyCheck = spawnSync('ls -l /etc/apt/keyrings/influxdata-archive_compat.asc', {
      shell: true,
      stdio: 'pipe',
    })
    if (keyCheck.status !== 0) {
      throw new Error('Failed to add influxdata GPG key')
    }

    // Add repository
    spawnSync(
      'echo "deb [signed-by=/etc/apt/keyrings/influxdata-archive_compat.asc] https://repos.influxdata.com/ubuntu stable main" | sudo tee /etc/apt/sources.list.d/influxdb.list',
      {
        shell: true,
        stdio: 'inherit',
      },
    )

    // Update package list
    console.log(chalk.white('Updating package list...'))
    spawnSync('sudo apt update', {
      shell: true,
      stdio: 'inherit',
    })

    // Install telegraf
    console.log(chalk.white('Installing telegraf...'))
    const installResult = spawnSync('sudo apt install telegraf -y', {
      shell: true,
      stdio: 'inherit',
    })

    if (installResult.status !== 0) {
      throw new Error('Failed to install telegraf')
    }

    console.log(chalk.green('✅ Telegraf installed successfully'))
  } else if (hasYum.stdout.toString().trim()) {
    // RHEL/CentOS setup
    console.log(chalk.white('Detected yum package manager'))
    throw new Error('Yum-based installation not yet implemented')
  } else {
    throw new Error('No supported package manager found (apt or yum required)')
  }
}

