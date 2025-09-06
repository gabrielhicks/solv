import { program } from '@/index'
import { updateVersion } from '../update'
import { jitoUpdate } from '../update/jitoUpdate'
import { DefaultConfigType } from '@/config/types'
import { Network, NodeType, ValidatorType } from '@/config/enums'
import {
  VERSION_JITO_MAINNET,
  VERSION_MAINNET,
  VERSION_SOLANA_RPC,
  VERSION_TESTNET,
} from '@/config/versionConfig'

export const installCommands = (config: DefaultConfigType) => {
  const isTestnet = config.NETWORK === Network.TESTNET
  let version = isTestnet ? VERSION_TESTNET : VERSION_MAINNET
  if (config.NODE_TYPE === NodeType.RPC) {
    version = VERSION_SOLANA_RPC
  }
  program
    .command('install')
    .alias('i')
    .description('Install Solana Client')
    .option(
      '-v, --version <version>',
      `Solana Version e.g. ${version}`,
      version,
    )
    .option(
      '-m, --mod <version>',
      `Use modified installer`,
      false,
    )
    .action(async (options: { version: string, mod: boolean }) => {
      const isJito = config.VALIDATOR_TYPE === ValidatorType.JITO
      const isModified = options.mod || config.MOD;
      if (isJito) {
        const jitoVersion = options.version || VERSION_JITO_MAINNET
        const jitoTag = `v${jitoVersion}`
        const isMajorThree = jitoVersion.startsWith("3") ? true : false;
        jitoUpdate(jitoTag, isModified, isMajorThree)
        return
      }
      const isRPC = config.NODE_TYPE === NodeType.RPC
      if (isRPC) {
        version = VERSION_SOLANA_RPC
      }
      const solanaCLIVersion = options.version || version
      await updateVersion(solanaCLIVersion, isModified)
    })
}
