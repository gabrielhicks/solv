import {
  IDENTITY_KEY,
  IDENTITY_KEY_PATH,
  LEDGER_PATH,
  MAINNET_VALIDATOR_KEY_PATH,
  SOLV_HOME,
  TESTNET_VALIDATOR_KEY_PATH,
  UNSTAKED_KEY,
} from '@/config/constants'
import { join } from 'path'
import { spawnSync } from 'node:child_process'
import chalk from 'chalk'
import checkValidatorKey from './checkValidatorKey'
import { updateDefaultConfig } from '@/config/updateDefaultConfig'
import { DefaultConfigType } from '@/config/types'
import { Network, NodeType } from '@/config/enums'
import getSolanaCLIActive from '@/config/getSolanaCLIActive'
import getSolanaCLIAgave from '@/config/getSolanaCLIAgave'

const unstakedKeyPath = join(SOLV_HOME, UNSTAKED_KEY)
const identityKeyPath = join(SOLV_HOME, IDENTITY_KEY)

export const changeIdentityIncoming = async (
  ip: string,
  pubkey: string,
  config: DefaultConfigType,
  user: string,
  client: string,
  safe = true,
) => {
  const isTestnet = config.NETWORK === Network.TESTNET
  const isRPC = config.NODE_TYPE === NodeType.RPC
  let validatorKeyPath = isTestnet
    ? TESTNET_VALIDATOR_KEY_PATH
    : MAINNET_VALIDATOR_KEY_PATH
  if (isRPC) {
    validatorKeyPath = TESTNET_VALIDATOR_KEY_PATH
  }
  const [activeSolanaClient, activeSolanaClientConfig] =
    getSolanaCLIActive(client)
  const agaveSolanaClient = getSolanaCLIAgave()

  const isKeyOkay = checkValidatorKey(validatorKeyPath, ip, user)
  if (!isKeyOkay) {
    return
  }
  
  if (safe) {
    console.log(chalk.white('🟢 Waiting for restart window...'))
    const restartWindowCmd = `ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ${user}@${ip} -p 22 'cd ~ && source ~/.profile && ${agaveSolanaClient} wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check'`
    const result1 = spawnSync(restartWindowCmd, { shell: true, stdio: 'inherit' })
    if (result1.status !== 0) {
      console.log(
        chalk.yellow(
          `⚠️ wait-for-restart-window Failed. Please check your Validator\n$ ssh ${user}@${ip}\n\nFailed Cmd: ${agaveSolanaClient} wait-for-restart-window --min-idle-time 2 --skip-new-snapshot-check`,
        ),
      )
      return
    }
  }

  // Set the identity on the unstaked key
  console.log(chalk.white('🟢 Setting identity on the new validator...'))
  const setIdentityCmd = `ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ${user}@${ip} -p 22 'cd ~ && source ~/.profile && ${activeSolanaClient} set-identity ${activeSolanaClientConfig}${unstakedKeyPath}'`
  const result2 = spawnSync(setIdentityCmd, { shell: true, stdio: 'inherit' })
  if (result2.status !== 0) {
    console.log(
      chalk.yellow(
        `⚠️ Set Identity Failed. Please check your Validator\n$ ssh ${user}@${ip}\n\nFailed Cmd: ${activeSolanaClient} set-identity ${activeSolanaClientConfig}${unstakedKeyPath}`,
      ),
    )
    return
  }

  // Change the Symlink to the unstaked keypair
  console.log(
    chalk.white('🟢 Changing the Symlink to the new validator keypair...'),
  )
  const result3 = spawnSync(
    `ssh -i ~/.ssh/id_rsa -o StrictHostKeyChecking=no ${user}@${ip} -p 22 'cd ~ && source ~/.profile && ln -sf ${unstakedKeyPath} ${identityKeyPath}'`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )

  if (result3.status !== 0) {
    console.log(
      chalk.yellow(
        `⚠️ Chaning Identity Key Symlink Failed. Please check your Validator\n$ ssh ${user}@${ip}\n\nFailed Cmd: ln -sf ${unstakedKeyPath} ${identityKeyPath}`,
      ),
    )
    return
  }

  // Download the tower file to the new validator
  console.log(
    chalk.white('🟢 Uploading the tower file to the new validator...'),
  )
  const result4 = spawnSync(
    `scp ${user}@${ip}:${LEDGER_PATH}/tower-1_9-${pubkey}.bin ${LEDGER_PATH}`,
    { shell: true, stdio: 'inherit' },
  )
  if (result4.status !== 0) {
    console.log(
      chalk.yellow(
        `⚠️ Upload Tower File Failed. Please check your tower file\n$ ssh ${user}@${ip}\n\nFailed Cmd: scp ${user}@${ip}:${LEDGER_PATH}/tower-1_9-${pubkey}.bin ${LEDGER_PATH}`,
      ),
    )
    return
  }

  // Set the identity on the new validator
  console.log(chalk.white('🟢 Setting identity on the new validator...'))
  const result5 = spawnSync(
    `${activeSolanaClient} set-identity ${activeSolanaClientConfig}--require-tower ${validatorKeyPath}`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  if (result5.status !== 0) {
    console.log(
      chalk.yellow(
        `⚠️ Set Identity Failed. Please check your Validator\n\nFailed Cmd: ${activeSolanaClient} set-identity ${activeSolanaClientConfig}${validatorKeyPath}\nln -sf ${validatorKeyPath} ${IDENTITY_KEY_PATH}`,
      ),
    )
    return
  }

  const result6 = spawnSync(`ln -sf ${validatorKeyPath} ${IDENTITY_KEY_PATH}`, {
    shell: true,
    stdio: 'inherit',
  })

  if (result6.status !== 0) {
    console.log(
      chalk.yellow(
        `⚠️ Chaning Identity Key Symlink Failed. Please check your Validator\n\nFailed Cmd: ln -sf ${validatorKeyPath} ${IDENTITY_KEY_PATH}`,
      ),
    )
    return
  }

  console.log(chalk.white('🟢 Identity changed successfully!'))
  await updateDefaultConfig({
    IS_DUMMY: false,
  })
}
