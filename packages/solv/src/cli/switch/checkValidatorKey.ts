import { getSolanaAddress } from '@/lib/getSolanaAddress'
import scpSSH from '@/lib/scpSSH'
import chalk from 'chalk'

const checkValidatorKey = (
  validatorKeyPath: string,
  ip: string,
  user: string,
) => {
  console.log(
    chalk.white('🔍 Checking If Destination Validator Key is the same...'),
  )
  const localValidatorIdentityAddress =
    getSolanaAddress(validatorKeyPath).trim()
  const destinationValidatorIdentityAddress = scpSSH(
    ip,
    `solana-keygen pubkey ${validatorKeyPath}`,
    user,
  )
    .stdout.toString()
    .trim()

  if (localValidatorIdentityAddress !== destinationValidatorIdentityAddress) {
    console.log(
      chalk.yellow(
        `⚠️ Destination Identity Key is different. 
Please check your Validator
$ ssh ${user}@${ip}

Local Identity Key: ${localValidatorIdentityAddress}
Destination Identity Key: ${destinationValidatorIdentityAddress}`,
      ),
    )
    return false
  }
  return true
}

export default checkValidatorKey
