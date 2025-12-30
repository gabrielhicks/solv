import { spawnSync } from 'child_process'
import chalk from 'chalk'
import { writeFileSync } from 'fs'

export const setupCpuFreqUtils = () => {
  try {
    console.log(chalk.white('⚡ Setting up CPU frequency governor with cpufrequtils...'))
    
    // Install cpufrequtils
    console.log(chalk.gray('Installing cpufrequtils...'))
    const installResult = spawnSync('sudo apt install cpufrequtils -y', {
      shell: true,
      stdio: 'inherit',
    })
    
    if (installResult.status !== 0) {
      throw new Error('Failed to install cpufrequtils')
    }
    
    // Create/update cpufrequtils config
    console.log(chalk.gray('Configuring cpufrequtils...'))
    const configContent = 'GOVERNOR="performance"\n'
    const tempConfigPath = '/tmp/cpufrequtils.conf'
    writeFileSync(tempConfigPath, configContent, 'utf-8')
    
    spawnSync(`sudo mv ${tempConfigPath} /etc/default/cpufrequtils`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo chmod 644 /etc/default/cpufrequtils', {
      shell: true,
      stdio: 'inherit',
    })
    
    // Restart and enable service
    console.log(chalk.gray('Enabling cpufrequtils service...'))
    spawnSync('sudo systemctl restart cpufrequtils', {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo systemctl enable cpufrequtils', {
      shell: true,
      stdio: 'inherit',
    })
    
    // Verify governor is set
    console.log(chalk.gray('Verifying CPU governor...'))
    spawnSync('cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor', {
      shell: true,
      stdio: 'inherit',
    })
    
    console.log(chalk.green('✅ CPU frequency governor configured'))
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️  Warning: Could not setup cpufrequtils: ${error.message}`))
  }
}

