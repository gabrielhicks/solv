import { LEDGER_PATH } from '@/config/constants'
import { DefaultConfigType } from '@/config/types'
import { spawnSync } from 'node:child_process'

const createSnapshot = (slot = '306450862', ledgerPath = LEDGER_PATH, config: DefaultConfigType) => {
  try {
    const cmd = `agave-ledger-tool --ledger ${ledgerPath} create-snapshot \
--incremental \
--snapshot-archive-path  ${config.SNAPSHOTS_PATH} \
--hard-fork ${slot} \
--  ${slot} ${ledgerPath}`
    const result = spawnSync(cmd, {
      shell: true,
      stdio: 'pipe',
      cwd: ledgerPath,
    })
    if (result.status !== 0) {
      throw new Error(`createSnapshot: ${result.error}`)
    }
  } catch (error) {
    throw new Error(`createSnapshot: ${error}`)
  }
}
export default createSnapshot
