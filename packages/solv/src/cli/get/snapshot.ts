import { LEDGER_PATH, SNAPSHOTS_PATH } from '@/config/constants'
import { spawnSync } from 'node:child_process'

export const getSnapshot = (
  isTest = false,
  minDownloadSpeed = '45',
  ledgerPath = LEDGER_PATH,
  snapshotPath = SNAPSHOTS_PATH,
  version: string,
  rpcUrl = isTest ? 'https://api.testnet.solana.com' : 'https://api.mainnet-beta.solana.com',
  useAvorio = false,
) => {
  try {
    let cmd = `docker run -it --rm -v ${ledgerPath}:${snapshotPath} --user $(id -u):$(id -g) c29r3/solana-snapshot-finder:latest --snapshot_path ${snapshotPath} --min_download_speed ${minDownloadSpeed} --version ${version} --rpc ${rpcUrl}`
    if (isTest && useAvorio) {
      spawnSync(
        `wget --trust-server-names https://snapshots.avorio.network/testnet/snapshot.tar.bz2 https://snapshots.avorio.network/testnet/incremental-snapshot.tar.bz2 && for file in snapshot-* incremental-snapshot-*; do mv "$file" "$(echo "$file" | sed 's/\\?.*$//')"; done`,
        { shell: true, stdio: 'inherit', cwd: snapshotPath },
      );
      return
    }
    spawnSync(cmd, { shell: true, stdio: 'inherit' })
  } catch (error) {
    throw new Error(`getSnapshot Error: ${error}`)
  }
}
