import { LEDGER_PATH } from '@/config/constants'
import { spawnSync } from 'child_process'
import installAgave from '../install/installAgave'
import getSolanaCLI from '@/config/getSolanaCLI'

export const updateVersion = async (version: string, mod = false) => {
  installAgave(version, mod)
  return
}

export const monitorUpdate = async (
  maxDelinquentStake: number,
  noMonitor = false,
) => {
  const solanaValidatorClient = getSolanaCLI()
  let cmd = `${solanaValidatorClient} --ledger ${LEDGER_PATH} exit --max-delinquent-stake ${maxDelinquentStake} --monitor`
  if (noMonitor) {
    cmd = `${solanaValidatorClient} --ledger ${LEDGER_PATH} exit --max-delinquent-stake ${maxDelinquentStake}`
  }
  spawnSync(cmd, { shell: true, stdio: 'inherit' })
}
