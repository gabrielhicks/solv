import { Network, ValidatorType } from '@/config/enums'
import { DefaultConfigType } from '@/config/types'
import { spawnSync } from 'node:child_process'
import { readlink } from 'fs/promises'
import chalk from 'chalk'
import readline from 'readline'

export const stopSolana = async (config: DefaultConfigType) => {
  chalk.white(console.log('Starting solv stop process...'))
  const service =
    config.VALIDATOR_TYPE === ValidatorType.FRANKENDANCER
      ? 'frankendancer'
      : 'solv'
  const isTest = config.NETWORK === Network.TESTNET

  const symlinkPath = '/home/solv/identity.json'
  const targetPath = '/home/solv/mainnet-validator-keypair.json'

  if (!isTest) {
    let symlinkTarget = ''
    try {
      symlinkTarget = await readlink(symlinkPath)
      chalk.white(console.log(`Confirmed symlink at: ${symlinkTarget}`))
    } catch (err) {
      chalk.white(console.log(`Could not verify symlink`))
    }

    if (symlinkTarget === targetPath) {
      const confirmed = await promptConfirm(
        `WARNING: You are about to stop a mainnet validator using the mainnet keypair (${targetPath}).\nAre you sure? (yes/no): `,
      )
      if (!confirmed) {
        chalk.white(console.log('Operation cancelled.'))
        return
      }
    }
  }

  const cmd = [`sudo systemctl stop ${service}`]
  spawnSync(cmd[0], { shell: true, stdio: 'inherit' })
}

function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'yes')
    })
  })
}
