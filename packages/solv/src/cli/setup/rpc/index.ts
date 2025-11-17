import installAgave from '@/cli/install/installAgave'
import { installJito } from '@/cli/install/installJito'
import { STARTUP_SCRIPT } from '@/config/constants'
import { RpcType } from '@/config/enums'
import { DefaultConfigType } from '@/config/types'
// import { readOrCreateJitoConfig } from '@/lib/readOrCreateJitoConfig'
import { startJitoRPCScript } from '@/template/startupScripts/startJitoRPCScript'
import { existsAsync } from '@skeet-framework/utils'
import { writeFile } from 'fs/promises'
import updateStartupScriptPermissions from '@/cli/setup/updateStartupScriptPermission'
import { JITO_PATCH, VERSION_JITO_TESTNET } from '@/config/versionConfig'
import { startRPCNodeScript } from '@/template/startupScripts/startRPCNodeScript'

const setupRpcNode = async (config: DefaultConfigType) => {
  const rpcType = config.RPC_TYPE
  let startupScript = ''
  switch (rpcType) {
    case RpcType.AGAVE:
      console.log('Agave RPC Node Setup')
      installAgave(config.TESTNET_SOLANA_VERSION)
      startupScript = startRPCNodeScript()
      break
    case RpcType.JITO:
      console.log('JITO RPC Node Setup')
      const jitoPatch = JITO_PATCH
      const jitoTagBase = `v${VERSION_JITO_TESTNET}-jito`
      const jitoTag = `${jitoTagBase}${jitoPatch}`
      installJito(jitoTag)
      startupScript = startJitoRPCScript()
      break
    // case RpcType.JUPITER_GEYSER:
    //   installJito(config.TESTNET_SOLANA_VERSION)
    //   break
    default:
      console.log('Unknown RPC Node Setup')
      break
  }
  if (await existsAsync(STARTUP_SCRIPT)) {
    console.log('Startup script already exists. Skipping...')
    return
  }
  await writeFile(STARTUP_SCRIPT, startupScript, 'utf-8')
  updateStartupScriptPermissions()
}

export default setupRpcNode
