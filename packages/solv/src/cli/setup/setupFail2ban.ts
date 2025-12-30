import { spawnSync } from 'child_process'
import chalk from 'chalk'
import { writeFileSync } from 'fs'

export const setupFail2ban = () => {
  try {
    console.log(chalk.white('🛡️  Setting up fail2ban...'))
    
    // Create jail.local config
    console.log(chalk.gray('Creating fail2ban configuration...'))
    const jailConfig = `[DEFAULT]
maxretry = 1
bantime.increment = true
bantime  = 60m
ignoreip = 127.0.0.1/8
`
    
    const tempConfigPath = '/tmp/jail.local'
    writeFileSync(tempConfigPath, jailConfig, 'utf-8')
    
    spawnSync(`sudo mv ${tempConfigPath} /etc/fail2ban/jail.local`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo chmod 644 /etc/fail2ban/jail.local', {
      shell: true,
      stdio: 'inherit',
    })
    
    // Reload daemon, enable and start fail2ban
    console.log(chalk.gray('Enabling fail2ban service...'))
    spawnSync('sudo systemctl daemon-reload', {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo systemctl enable fail2ban.service', {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync('sudo systemctl start fail2ban.service', {
      shell: true,
      stdio: 'inherit',
    })
    
    console.log(chalk.green('✅ fail2ban configured and started'))
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️  Warning: Could not setup fail2ban: ${error.message}`))
  }
}

