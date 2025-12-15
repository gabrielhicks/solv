import { getKeypairsInfo } from '@/cli/balance'
import {
  IDENTITY_KEY_PATH,
  LOG_PATH,
  MAINNET_KNOWN_VALIDATORS,
  MAINNET_VALIDATOR_KEY_PATH,
  MAINNET_VALIDATOR_VOTE_KEY_PATH,
} from '@/config/constants'
import { DefaultConfigType } from '@/config/types'
import { execSync } from 'node:child_process'

export const startJitoMainnetScript = (
  commissionBps = 0,
  relayerUrl: string,
  blockEngineUrl: string,
  shredReceiverAddr: string,
  config: DefaultConfigType,
  solanaCLI = 'agave-validator',
) => {
  const {validatorKeyAddress} = getKeypairsInfo(config)

  const xdpEnabled = config.XDP
  const zeroCopyEnabled = config.ZERO_COPY
  const jagSnapshotsEnabled = config.JAG_SNAPSHOTS
  const localIp = execSync(`hostname -I | awk '{print $1}'`).toString().trim()
  const defaultPort = "18899"
  const publicRpc = `${localIp}:${defaultPort}`
  const jagFlags = jagSnapshotsEnabled ? [`--public-rpc-address ${publicRpc} \\`,`--no-port-check \\`].join('\n') : [`--full-rpc-api \\`, `--private-rpc \\`].join('\n')
  const xdpFlags = xdpEnabled ? [`--experimental-retransmit-xdp-cpu-cores 1 \\`,`--experimental-poh-pinned-cpu-core 10 \\`].join('\n') : ''
  const zeroCopyFlag = zeroCopyEnabled ? [`--experimental-retransmit-xdp-zero-copy \\`].join('\n') : ''

  const knownValidators = MAINNET_KNOWN_VALIDATORS;

  const filteredValidators = knownValidators.filter(
    (address) => address !== validatorKeyAddress
  );

  const validatorArgs = filteredValidators
    .map((address) => `--known-validator ${address} \\`)
    .join('\n');

  const script = `#!/bin/bash
exec ${solanaCLI} \\
--identity ${IDENTITY_KEY_PATH} \\
--vote-account ${MAINNET_VALIDATOR_VOTE_KEY_PATH} \\
--authorized-voter  ${MAINNET_VALIDATOR_KEY_PATH} \\
--log ${LOG_PATH} \\
--accounts ${config.ACCOUNTS_PATH} \\
--ledger ${config.LEDGER_PATH} \\
--snapshots ${config.SNAPSHOTS_PATH} \\
--entrypoint entrypoint.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint2.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint3.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint4.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint5.mainnet-beta.solana.com:8001 \\
${validatorArgs}
--expected-genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \\
--tip-payment-program-pubkey T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt \\
--tip-distribution-program-pubkey 4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7 \\
--merkle-root-upload-authority GZctHpWXmsZC1YHACTGGcHhYxjdRqQvTpYkb9LMvxDib \\
--commission-bps ${commissionBps} \\
--block-engine-url ${blockEngineUrl} \\
--shred-receiver-address ${shredReceiverAddr} \\
--dynamic-port-range 8000-8025 \\
--rpc-bind-address 127.0.0.1 \\
--rpc-port 8899 \\
${jagFlags}
--wal-recovery-mode skip_any_corrupted_record \\
--limit-ledger-size 50000000 \\
--block-production-method central-scheduler-greedy \\
--block-verification-method unified-scheduler \\
--maximum-full-snapshots-to-retain 1 \\
--maximum-incremental-snapshots-to-retain 2 \\
${xdpFlags}
${zeroCopyFlag}
`
// To be added later for XDP
// --experimental-retransmit-xdp-cpu-cores 2 \\
// --experimental-retransmit-xdp-zero-copy \\
// --experimental-poh-pinned-cpu-core 6 \\
  return script
}
