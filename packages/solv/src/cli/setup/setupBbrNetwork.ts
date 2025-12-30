import { spawnSync } from 'child_process'
import chalk from 'chalk'
import { writeFileSync } from 'fs'

export const setupBbrNetwork = () => {
  try {
    console.log(chalk.white('🌐 Setting up BBR network congestion control...'))
    
    // Load tcp_bbr module
    console.log(chalk.gray('Loading tcp_bbr module...'))
    spawnSync('sudo modprobe tcp_bbr', {
      shell: true,
      stdio: 'inherit',
    })
    
    // Create BBR sysctl config
    console.log(chalk.gray('Configuring BBR settings...'))
    const bbrConfig = `# Enable BBR congestion control + fq qdisc
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
`
    
    const tempConfigPath = '/tmp/99-bbr.conf'
    writeFileSync(tempConfigPath, bbrConfig, 'utf-8')
    
    spawnSync(`sudo mv ${tempConfigPath} /etc/sysctl.d/99-bbr.conf`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo chmod 644 /etc/sysctl.d/99-bbr.conf', {
      shell: true,
      stdio: 'inherit',
    })
    
    // Apply sysctl settings
    console.log(chalk.gray('Applying sysctl settings...'))
    spawnSync('sudo sysctl --system', {
      shell: true,
      stdio: 'inherit',
    })
    
    console.log(chalk.green('✅ BBR network congestion control configured'))
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️  Warning: Could not setup BBR: ${error.message}`))
  }
}

