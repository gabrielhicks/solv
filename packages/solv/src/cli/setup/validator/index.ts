import installAgave from '@/cli/install/installAgave'
import { installJito } from '@/cli/install/installJito'
import installSolana from '@/cli/install/installSolana'
import { STARTUP_SCRIPT } from '@/config/constants'
import { Network, ValidatorType } from '@/config/enums'
import { DefaultConfigType } from '@/config/types'
import { readOrCreateJitoConfig } from '@/lib/readOrCreateJitoConfig'
import { startJitoMainnetScript } from '@/template/startupScripts/startJitoMainnetScript'
import { startJitoTestnetScript } from '@/template/startupScripts/startJitoTestnetScript'
import { startMainnetValidatorScript } from '@/template/startupScripts/startMainnetValidatorScript'
import { startTestnetAgaveValidatorScript } from '@/template/startupScripts/startTestnetAgaveValidatorScript'
import { existsAsync } from '@skeet-framework/utils'
import { writeFile } from 'fs/promises'
import updateStartupScriptPermissions from '@/cli/setup/updateStartupScriptPermission'

const setupValidatorNode = async (config: DefaultConfigType, mod = false) => {
  const { NETWORK: network, MOD: modConfig } = config
  mod = modConfig
  if (network === Network.MAINNET) {
    console.log('Mainnet Validator Node Setup')
    await setupMainnetValidator(config, mod)
  } else if (network === Network.TESTNET) {
    console.log('Testnet Validator Node Setup')
    await setupTestnetValidator(config, mod)
  } else {
    console.log('Unknown Network Validator Node Setup')
  }
}

const setupMainnetValidator = async (config: DefaultConfigType, mod = false) => {
  const { VALIDATOR_TYPE: validatorType, MAINNET_SOLANA_VERSION: version, MOD: modConfig } =
    config
  mod = modConfig
  let startupScript = ''
  let isMajorThree = version.startsWith("3") ? true : false;
  switch (validatorType) {
    case ValidatorType.SOLANA:
      installSolana(version)
      startupScript = startMainnetValidatorScript(config)
      break
    // case ValidatorType.AGAVE:
    //   console.log('Coming soon...🌉')
    //   break
    case ValidatorType.JITO:
      console.log('JITO Validator Setup for Mainnet')
      const jitoConfig = await readOrCreateJitoConfig()
      installJito(version, mod, isMajorThree)
      startupScript = startJitoMainnetScript(
        jitoConfig.commissionBps,
        jitoConfig.relayerUrl,
        jitoConfig.blockEngineUrl,
        jitoConfig.shredReceiverAddr,
        config
      )
      break
    // case ValidatorType.FRANKENDANCER:
    //   console.log('Coming soon...🌉')
    //   break
    // case ValidatorType.FIREDANCER:
    //   console.log('Coming soon...🌉')
    //   break
    default:
      console.log('Unknown Validator Type for Mainnet')
      break
  }
  if (await existsAsync(STARTUP_SCRIPT)) {
    console.log('Startup script already exists. Skipping...')
    return
  }
  await writeFile(STARTUP_SCRIPT, startupScript, 'utf-8')
  updateStartupScriptPermissions()
}

const setupTestnetValidator = async (config: DefaultConfigType, mod = false) => {
  const { VALIDATOR_TYPE: validatorType, MOD: modConfig } = config
  mod = modConfig
  let startupScript = ''
  let isMajorThree = config.TESTNET_SOLANA_VERSION.startsWith("3") ? true : false;
  switch (validatorType) {
    case ValidatorType.SOLANA:
      installSolana(config.TESTNET_SOLANA_VERSION)
      startupScript = startTestnetAgaveValidatorScript(config)
    case ValidatorType.AGAVE:
      console.log('Agave Validator Setup for Testnet')
      installAgave(config.TESTNET_SOLANA_VERSION, mod, isMajorThree)
      startupScript = startTestnetAgaveValidatorScript(config)
      break
    case ValidatorType.JITO:
      console.log('JITO Validator Setup for Testnet')
      const jitoConfig = await readOrCreateJitoConfig()
      installJito(config.TESTNET_SOLANA_VERSION, mod, isMajorThree)
      startupScript = startJitoTestnetScript(
        jitoConfig.commissionBps,
        jitoConfig.relayerUrl,
        jitoConfig.blockEngineUrl,
        jitoConfig.shredReceiverAddr,
        config
      )
      break
    // case ValidatorType.FRANKENDANCER:
    //   console.log('Coming soon...🌉')
    //   break
    // case ValidatorType.FIREDANCER:
    //   console.log('Coming soon...🌉')
    //   break
    default:
      console.log('Unknown Validator Type for Testnet')
      break
  }
  if (await existsAsync(STARTUP_SCRIPT)) {
    console.log('Startup script already exists. Skipping...')
    return
  }
  await writeFile(STARTUP_SCRIPT, startupScript, 'utf-8')
  updateStartupScriptPermissions()
}

export default setupValidatorNode
