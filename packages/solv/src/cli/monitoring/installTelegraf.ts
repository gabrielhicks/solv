import { spawnSync } from 'node:child_process'
import chalk from 'chalk'

const INFLUX_RECV_KEY = 'DA61C26A0585BD3B'
const INFLUX_EXPORT_KEY = '7C3D57159FC2F927'

export const installTelegraf = async (): Promise<void> => {
  console.log(chalk.white('📦 Installing telegraf...'))

  const hasApt = spawnSync('which apt', { shell: true, stdio: 'pipe' })
  const hasYum = spawnSync('which yum', { shell: true, stdio: 'pipe' })

  if (hasApt.stdout.toString().trim()) {
    console.log(chalk.white('Detected apt package manager'))

    // Clean up any stray keys from both locations
    spawnSync(
      'sudo rm -f /etc/apt/trusted.gpg /etc/apt/trusted.gpg.d/influxdata.gpg /etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg',
      { shell: true, stdio: 'inherit' },
    )

    // Create keyrings directory
    spawnSync('sudo mkdir -p /etc/apt/keyrings', {
      shell: true,
      stdio: 'inherit',
    })

    // Receive the GPG key from keyserver
    console.log(chalk.white('Fetching InfluxData GPG key...'))
    const recvResult = spawnSync(
      `sudo gpg --keyserver keyserver.ubuntu.com --recv-keys ${INFLUX_RECV_KEY}`,
      { shell: true, stdio: 'inherit' },
    )
    if (recvResult.status !== 0) {
      throw new Error('Failed to receive InfluxData GPG key from keyserver')
    }

    // Export in ASCII-armored format to match the .asc extension
    const exportResult = spawnSync(
      `sudo gpg --export --armor ${INFLUX_EXPORT_KEY} | sudo tee /etc/apt/keyrings/influxdata-archive_compat.asc > /dev/null`,
      { shell: true, stdio: 'inherit' },
    )
    if (exportResult.status !== 0) {
      throw new Error('Failed to export InfluxData GPG key')
    }

    // Add repository
    spawnSync(
      'echo "deb [signed-by=/etc/apt/keyrings/influxdata-archive_compat.asc] https://repos.influxdata.com/ubuntu stable main" | sudo tee /etc/apt/sources.list.d/influxdb.list',
      { shell: true, stdio: 'inherit' },
    )

    // Clear apt cache then update
    console.log(chalk.white('Updating package list...'))
    spawnSync('sudo apt clean', { shell: true, stdio: 'inherit' })
    spawnSync('sudo apt update', { shell: true, stdio: 'inherit' })

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
    console.log(chalk.white('Detected yum package manager'))
    throw new Error('Yum-based installation not yet implemented')
  } else {
    throw new Error('No supported package manager found (apt or yum required)')
  }
}
