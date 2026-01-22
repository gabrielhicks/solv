import { getKeypairsInfo } from '@/cli/balance'
import {
  IDENTITY_KEY_PATH,
  LOG_PATH,
  TESTNET_KNOWN_VALIDATORS,
  TESTNET_VALIDATOR_KEY_PATH,
  TESTNET_VALIDATOR_VOTE_KEY_PATH,
} from '@/config/constants'
import { DefaultConfigType } from '@/config/types'

export const startTestnetAgaveValidatorScript = (config: DefaultConfigType) => {
  const { validatorKeyAddress } = getKeypairsInfo(config)

  const xdpEnabled = config.XDP
  const zeroCopyEnabled = config.ZERO_COPY
  // const jagSnapshotsEnabled = config.JAG_SNAPSHOTS
  const xdpFlags = xdpEnabled
    ? [
        `--experimental-retransmit-xdp-cpu-cores 1 \\`,
        `--experimental-poh-pinned-cpu-core 10 \\`,
      ].join('\n')
    : ''
  const zeroCopyFlag = zeroCopyEnabled
    ? [`--experimental-retransmit-xdp-zero-copy \\`].join('\n')
    : ''

  const knownValidators = TESTNET_KNOWN_VALIDATORS

  const filteredValidators = knownValidators.filter(
    (address) => address !== validatorKeyAddress,
  )

  const validatorArgs = filteredValidators
    .map((address) => `--known-validator ${address} \\`)
    .join('\n')
  const script = `#!/bin/bash
exec agave-validator \\
--identity ${IDENTITY_KEY_PATH} \\
--vote-account ${TESTNET_VALIDATOR_VOTE_KEY_PATH} \\
--authorized-voter  ${TESTNET_VALIDATOR_KEY_PATH} \\
--log ${LOG_PATH} \\
--accounts ${config.ACCOUNTS_PATH} \\
--ledger ${config.LEDGER_PATH} \\
--snapshots ${config.SNAPSHOTS_PATH} \\
--entrypoint entrypoint.testnet.solana.com:8001 \\
--entrypoint entrypoint2.testnet.solana.com:8001 \\
--entrypoint entrypoint3.testnet.solana.com:8001 \\
${validatorArgs}
--only-known-rpc \\
--rpc-bind-address 0.0.0.0 \\
--expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\
--dynamic-port-range 8000-8025 \\
--rpc-port 8899 \\
--wal-recovery-mode skip_any_corrupted_record \\
--wait-for-supermajority 383520372 \\
--expected-shred-version 27350 \\
--expected-bank-hash 3zk4WMwk6wCTVJXu9UAk2dYWMedCKooDs15XL5u6FkvE \\
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
