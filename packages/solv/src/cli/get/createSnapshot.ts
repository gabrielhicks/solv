import { LEDGER_PATH, SNAPSHOTS_PATH } from '@/config/constants'
import { spawnSync } from 'node:child_process'

const createSnapshot = (slot = '306450862', ledgerPath = LEDGER_PATH, snapshotPath = SNAPSHOTS_PATH) => {
  try {
    const cmd = `agave-ledger-tool --ledger ${ledgerPath} create-snapshot \
--incremental \
--snapshot-archive-path  ${snapshotPath} \
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
