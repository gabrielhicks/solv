import { spawnSync } from 'child_process'
import chalk from 'chalk'

export const disableAutoUpdates = () => {
  try {
    console.log(chalk.white('🔒 Disabling auto updates...'))
    
    const aptConfigFile = '/etc/apt/apt.conf.d/99needrestart'
    
    // Check if file exists before modifying
    const checkResult = spawnSync(`test -f ${aptConfigFile}`, {
      shell: true,
    })
    
    if (checkResult.status === 0) {
      // Remove -m u flag
      spawnSync(`sudo sed -i 's/-m u//g' ${aptConfigFile}`, {
        shell: true,
        stdio: 'inherit',
      })
      
      // Comment out DPkg::Post-Invoke line
      spawnSync(`sudo sed -i 's/^\\(DPkg::Post-Invoke.*apt-pinvoke.*\\)$/\\/\\/ \\1/' ${aptConfigFile}`, {
        shell: true,
        stdio: 'inherit',
      })
      
      // Divert the file to disable it
      spawnSync(
        `sudo dpkg-divert --add --rename --divert ${aptConfigFile}.disabled ${aptConfigFile}`,
        {
          shell: true,
          stdio: 'inherit',
        },
      )
      
      console.log(chalk.green('✅ Auto updates disabled'))
    } else {
      console.log(chalk.gray('⚠️  /etc/apt/apt.conf.d/99needrestart not found, skipping'))
    }
  } catch (error: any) {
    console.log(chalk.yellow(`⚠️  Warning: Could not disable auto updates: ${error.message}`))
  }
}

