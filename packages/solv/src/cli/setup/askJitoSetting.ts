import { JITO_CONFIG, JITO_REGIONS, JitoConfig } from '@/config/jitConfig'
import inquirer from 'inquirer'

export const askJitoSetting = async (isTestnet: boolean) => {
  const commissionBps = 1000
  const jitRegions = isTestnet
    ? Object.keys(JITO_REGIONS.TESTNET)
    : Object.keys(JITO_REGIONS.MAINNET)
  const regionType = isTestnet ? JITO_REGIONS.TESTNET : JITO_REGIONS.MAINNET
  const answer = await inquirer.prompt<{
    commissionBps: number
    region: string
    isRelayer: boolean
  }>([
    {
      name: 'commissionBps',
      type: 'number',
      message: 'Enter commission bps',
      default: commissionBps,
    },
    {
      name: 'region',
      type: 'list',
      message: 'Select region',
      choices: jitRegions,
    },
  ])
  const regionKey = answer.region as keyof typeof regionType
  const regionArgs = regionType[regionKey]
  const result = {
    version: JITO_CONFIG.version,
    tag: JITO_CONFIG.tag,
    commissionBps: answer.commissionBps,
    blockEngineUrl: regionArgs.BLOCK_ENGINE_URL,
    relayerUrl: regionArgs.RELAYER_URL,
    shredReceiverAddr: regionArgs.SHRED_RECEIVER_ADDR,
  } as JitoConfig

  return result
}
