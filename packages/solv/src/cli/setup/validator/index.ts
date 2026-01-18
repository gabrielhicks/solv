import installAgave from '@/cli/install/installAgave'
import { installJito } from '@/cli/install/installJito'
import { STARTUP_SCRIPT } from '@/config/constants'
import { Network, ValidatorType } from '@/config/enums'
import { DefaultConfigType } from '@/config/types'
import { readOrCreateJitoConfig } from '@/lib/readOrCreateJitoConfig'
import { startJitoMainnetScript } from '@/template/startupScripts/startJitoMainnetScript'
import { startJitoTestnetScript } from '@/template/startupScripts/startJitoTestnetScript'
import { startMainnetValidatorScript } from '@/template/startupScripts/startMainnetValidatorScript'
import { startTestnetAgaveValidatorScript } from '@/template/startupScripts/startTestnetAgaveValidatorScript'
import { writeFile } from 'fs/promises'
import updateStartupScriptPermissions from '@/cli/setup/updateStartupScriptPermission'
import { startBamMainnetScript } from '@/template/startupScripts/startBamMainnetScript'
import { installBam } from '@/cli/install/installBam'
import { startBamTestnetScript } from '@/template/startupScripts/startBamTestnetScript'
import setupFiredancer from '../firedancer/setupFiredancer'
import {
  AGAVE_PATCH,
  BAM_PATCH,
  JITO_PATCH,
  VERSION_DZ_MAINNET,
  VERSION_DZ_TESTNET,
} from '@/config/versionConfig'
import installDZ from '@/cli/install/installDZ'

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

const setupMainnetValidator = async (
  config: DefaultConfigType,
  mod = false,
) => {
  const {
    VALIDATOR_TYPE: validatorType,
    MAINNET_SOLANA_VERSION: version,
    MOD: modConfig,
    XDP: xdpEnabled,
  } = config
  mod = modConfig
  let startupScript = ''
  let isMajorThree = version.startsWith('3') ? true : false
  installDZ(VERSION_DZ_MAINNET, false)
  switch (validatorType) {
    case ValidatorType.SOLANA:
      const agavePatch = AGAVE_PATCH
      const agaveTagBase = `v${version}`
      const agaveTag = `${agaveTagBase}${agavePatch}`
      installAgave(agaveTag)
      startupScript = startMainnetValidatorScript(config)
      break
    // case ValidatorType.AGAVE:
    //   console.log('Coming soon...🌉')
    //   break
    case ValidatorType.JITO:
      console.log('JITO Validator Setup for Mainnet')
      const jitoConfig = await readOrCreateJitoConfig()
      const jitoPatch = JITO_PATCH
      const jitoTagBase = `v${version}-jito`
      const jitoModBase = `v${version}-mod`
      const jitoTag = mod
        ? `${jitoModBase}${jitoPatch}`
        : `${jitoTagBase}${jitoPatch}`
      installJito(jitoTag, mod, isMajorThree, xdpEnabled)
      startupScript = startJitoMainnetScript(
        jitoConfig.commissionBps,
        jitoConfig.relayerUrl,
        jitoConfig.blockEngineUrl,
        jitoConfig.shredReceiverAddr,
        config,
      )
      break
    case ValidatorType.BAM:
      console.log('JITO Validator Setup for Mainnet')
      const bamConfig = await readOrCreateJitoConfig()
      const bamPatch = BAM_PATCH
      const bamTagBase = `v${version}-bam`
      const bamModBase = `v${version}-mod`
      const bamTag = mod
        ? `${bamModBase}${bamPatch}`
        : `${bamTagBase}${bamPatch}`
      installBam(bamTag, mod, isMajorThree, xdpEnabled)
      startupScript = startBamMainnetScript(
        bamConfig.commissionBps,
        bamConfig.relayerUrl,
        bamConfig.blockEngineUrl,
        bamConfig.shredReceiverAddr,
        bamConfig.bamUrl,
        config,
      )
      break
    case ValidatorType.FRANKENDANCER:
      await setupFiredancer(mod, config)
      break
    // case ValidatorType.FIREDANCER:
    //   console.log('Coming soon...🌉')
    //   break
    default:
      console.log('Unknown Validator Type for Mainnet')
      break
  }
  // if (await existsAsync(STARTUP_SCRIPT)) {
  //   console.log('Startup script already exists. Skipping...')
  //   return
  // }
  await writeFile(STARTUP_SCRIPT, startupScript, 'utf-8')
  updateStartupScriptPermissions()
}

const setupTestnetValidator = async (
  config: DefaultConfigType,
  mod = false,
) => {
  const {
    VALIDATOR_TYPE: validatorType,
    MOD: modConfig,
    TESTNET_SOLANA_VERSION: version,
    XDP: xdpEnabled,
  } = config
  mod = modConfig
  let startupScript = ''
  let isMajorThree = version.startsWith('3') ? true : false
  const agavePatch = AGAVE_PATCH
  const agaveTagBase = `v${version}`
  const agaveTag = `${agaveTagBase}${agavePatch}`
  const jitoPatch = JITO_PATCH
  const jitoTagBase = `v${version}-jito`
  const jitoModBase = `v${version}-mod`
  const jitoTag = mod
    ? `${jitoModBase}${jitoPatch}`
    : `${jitoTagBase}${jitoPatch}`
  const bamPatch = BAM_PATCH
  const bamTagBase = `v${version}-bam`
  const bamModBase = `v${version}-mod`
  const bamTag = mod ? `${bamModBase}${bamPatch}` : `${bamTagBase}${bamPatch}`
  installDZ(VERSION_DZ_TESTNET, true)
  switch (validatorType) {
    case ValidatorType.SOLANA:
      installAgave(agaveTag)
      startupScript = startTestnetAgaveValidatorScript(config)
    case ValidatorType.AGAVE:
      console.log('Agave Validator Setup for Testnet')
      installAgave(agaveTag)
      startupScript = startTestnetAgaveValidatorScript(config)
      break
    case ValidatorType.JITO:
      console.log('JITO Validator Setup for Testnet')
      const jitoConfig = await readOrCreateJitoConfig()
      installJito(jitoTag, mod, isMajorThree, xdpEnabled)
      startupScript = startJitoTestnetScript(
        jitoConfig.commissionBps,
        jitoConfig.relayerUrl,
        jitoConfig.blockEngineUrl,
        jitoConfig.shredReceiverAddr,
        config,
      )
      break
    case ValidatorType.BAM:
      console.log('BAM Validator Setup for Mainnet')
      const bamConfig = await readOrCreateJitoConfig()
      installBam(bamTag, mod, isMajorThree, xdpEnabled)
      startupScript = startBamTestnetScript(
        bamConfig.commissionBps,
        bamConfig.relayerUrl,
        bamConfig.blockEngineUrl,
        bamConfig.shredReceiverAddr,
        bamConfig.bamUrl,
        config,
      )
      break
    case ValidatorType.FRANKENDANCER:
      console.log('FRANKENDANCER Validator Setup for Mainnet')
      await setupFiredancer(mod, config)
      break
    // case ValidatorType.FIREDANCER:
    //   console.log('Coming soon...🌉')
    //   break
    default:
      console.log('Unknown Validator Type for Testnet')
      break
  }
  // if (await existsAsync(STARTUP_SCRIPT)) {
  //   console.log('Startup script already exists. Skipping...')
  //   return
  // }
  await writeFile(STARTUP_SCRIPT, startupScript, 'utf-8')
  updateStartupScriptPermissions()
}

export default setupValidatorNode
