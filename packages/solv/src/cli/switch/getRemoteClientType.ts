import scpSSH from '@/lib/scpSSH'
import { ValidatorType } from '@/config/enums'
import chalk from 'chalk'

export type RemoteConfigResult = {
  client: string
  validatorType: ValidatorType
  success: boolean
  error?: string
}

export const getRemoteClientType = async (
  ip: string,
  user: string
): Promise<RemoteConfigResult> => {
  try {
    console.log(chalk.white('🔍 Detecting client type from remote configuration...'))
    
    // Read the remote solv config file
    const configResult = scpSSH(
      ip,
      'cat /home/solv/solv4.config.json',
      user,
      'pipe'
    )

    if (configResult.status !== 0) {
      return {
        client: 'agave',
        validatorType: ValidatorType.AGAVE,
        success: false,
        error: 'Could not read remote configuration file'
      }
    }

    // Parse the config
    const remoteConfig = JSON.parse(configResult.stdout)
    const validatorType = remoteConfig.VALIDATOR_TYPE

    // Map validator type to client string
    let client: string
    switch (validatorType) {
      case ValidatorType.AGAVE:
        client = 'agave'
        break
      case ValidatorType.FRANKENDANCER:
        client = 'frankendancer'
        break
      case ValidatorType.JITO:
        client = 'agave' // Jito uses agave client
        break
      default:
        client = 'agave' // Default fallback
    }

    console.log(chalk.green(`✅ Detected remote client type: ${client} (${validatorType})`))
    
    return {
      client,
      validatorType,
      success: true
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Could not auto-detect client type: ${error}`))
    return {
      client: 'agave',
      validatorType: ValidatorType.AGAVE,
      success: false,
      error: String(error)
    }
  }
} 