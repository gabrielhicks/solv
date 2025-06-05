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
  minIdleTime = 10,
) => {
  const solanaValidatorClient = getSolanaCLI()
  let cmd = `${solanaValidatorClient} --ledger ${LEDGER_PATH} exit --max-delinquent-stake ${maxDelinquentStake} --monitor --min-idle-time ${minIdleTime}`
  if (noMonitor) {
    cmd = `${solanaValidatorClient} --ledger ${LEDGER_PATH} exit --max-delinquent-stake ${maxDelinquentStake} --min-idle-time ${minIdleTime}`
  }
  spawnSync(cmd, { shell: true, stdio: 'inherit' })
}
