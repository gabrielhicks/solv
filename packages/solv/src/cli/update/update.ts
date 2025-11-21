import { LEDGER_PATH } from '@/config/constants'
import { spawnSync } from 'child_process'
import installAgave from '../install/installAgave'
import getSolanaCLI from '@/config/getSolanaCLI'
import { AGAVE_PATCH } from '@/config/versionConfig'

export const updateVersion = async (version: string, mod = false, isMajorThree = false) => {
  const agavePatch = AGAVE_PATCH;
  const agaveTagBase = `v${version}`
  const agaveTag = `${agaveTagBase}${agavePatch}`
  installAgave(agaveTag, mod, isMajorThree)
  return
}

export const monitorUpdate = async (
  maxDelinquentStake: number,
  noMonitor = false,
  minIdleTime = 10,
) => {
  const solanaValidatorClient = getSolanaCLI()
  let cmd = `${solanaValidatorClient} --ledger ${LEDGER_PATH} exit --max-delinquent-stake ${maxDelinquentStake} --min-idle-time ${minIdleTime}`
  if (noMonitor) {
    cmd = `${solanaValidatorClient} --ledger ${LEDGER_PATH} exit --max-delinquent-stake ${maxDelinquentStake} --min-idle-time ${minIdleTime}`
  }
  spawnSync(cmd, { shell: true, stdio: 'inherit' })
}
