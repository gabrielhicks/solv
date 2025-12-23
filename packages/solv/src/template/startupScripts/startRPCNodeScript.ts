import {
  ACCOUNTS_PATH,
  IDENTITY_KEY_PATH,
  LEDGER_PATH,
  LOG_PATH,
  MAINNET_KNOWN_VALIDATORS,
  SNAPSHOTS_PATH,
} from '@/config/constants'
export const startRPCNodeScript = () => {
  const knownValidators = MAINNET_KNOWN_VALIDATORS;

  const filteredValidators = knownValidators.filter(
    (address) => address !== ""
  );

  const validatorArgs = filteredValidators
    .map((address) => `--known-validator ${address} \\`)
    .join('\n');
  
  const script = `#!/bin/bash
exec agave-validator \\
--identity ${IDENTITY_KEY_PATH} \\
--log ${LOG_PATH} \\
--accounts ${ACCOUNTS_PATH} \\
--ledger ${LEDGER_PATH} \\
--snapshots ${SNAPSHOTS_PATH} \\
--entrypoint entrypoint.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint2.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint3.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint4.mainnet-beta.solana.com:8001 \\
--entrypoint entrypoint5.mainnet-beta.solana.com:8001 \\
${validatorArgs}
--expected-genesis-hash 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d \\
--expected-shred-version 50093 \\
--only-known-rpc \\
--full-rpc-api \\
--no-voting \\
--private-rpc \\
--no-skip-initial-accounts-db-clean \\
--dynamic-port-range 8000-8025 \\
--rpc-bind-address 127.0.0.1 \\
--rpc-port 8899 \\
--no-port-check \\
--account-index program-id spl-token-mint spl-token-owner \\
--enable-rpc-transaction-history \\
--rpc-pubsub-enable-block-subscription \\
--rpc-pubsub-enable-vote-subscription \\
--no-wait-for-vote-to-start-leader \\
--wal-recovery-mode skip_any_corrupted_record \\
--use-snapshot-archives-at-startup when-newest \\
--limit-ledger-size 400000000 \\
`
  return script
}
