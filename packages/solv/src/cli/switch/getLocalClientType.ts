import { readFile } from 'fs/promises'
import { ValidatorType } from '@/config/enums'
import chalk from 'chalk'
import { existsSync } from 'fs'

export type LocalConfigResult = {
  client: string
  validatorType: ValidatorType
  success: boolean
  error?: string
}

export const getLocalClientType = async (): Promise<LocalConfigResult> => {
  try {
    console.log(chalk.white('🔍 Detecting local client type from configuration...'))
    
    const configPath = '/home/solv/solv4.config.json'
    
    if (!existsSync(configPath)) {
      return {
        client: 'agave',
        validatorType: ValidatorType.AGAVE,
        success: false,
        error: 'Local configuration file not found'
      }
    }

    // Read the local solv config file
    const configContent = await readFile(configPath, 'utf-8')
    const localConfig = JSON.parse(configContent)
    const validatorType = localConfig.VALIDATOR_TYPE

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

    console.log(chalk.green(`✅ Detected local client type: ${client} (${validatorType})`))
    
    return {
      client,
      validatorType,
      success: true
    }
  } catch (error) {
    console.log(chalk.yellow(`⚠️ Could not auto-detect local client type: ${error}`))
    return {
      client: 'agave',
      validatorType: ValidatorType.AGAVE,
      success: false,
      error: String(error)
    }
  }
} 