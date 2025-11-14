import { getKeypairsInfo } from '@/cli/balance';
import {
  IDENTITY_KEY_PATH,
  LOG_PATH,
  TESTNET_KNOWN_VALIDATORS,
  TESTNET_VALIDATOR_KEY_PATH,
  TESTNET_VALIDATOR_VOTE_KEY_PATH,
} from '@/config/constants'
import { DefaultConfigType } from '@/config/types'

export const startBamTestnetScript = (
  commissionBps = 10000,
  relayerUrl: string,
  blockEngineUrl: string,
  shredReceiverAddr: string,
  bamUrl: string,
  config: DefaultConfigType,
  solanaCLI = 'agave-validator',
) => {
  const {validatorKeyAddress} = getKeypairsInfo(config)

  const knownValidators = TESTNET_KNOWN_VALIDATORS;

  const filteredValidators = knownValidators.filter(
    (address) => address !== validatorKeyAddress
  );

  const validatorArgs = filteredValidators
    .map((address) => `--known-validator ${address} \\`)
    .join('\n');
  
  const script = `#!/bin/bash
exec ${solanaCLI} \\
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
--tip-payment-program-pubkey GJHtFqM9agxPmkeKjHny6qiRKrXZALvvFGiKf11QE7hy \\
--tip-distribution-program-pubkey F2Zu7QZiTYUhPd7u9ukRVwxh7B71oA3NMJcHuCHc29P2 \\
--merkle-root-upload-authority GZctHpWXmsZC1YHACTGGcHhYxjdRqQvTpYkb9LMvxDib \\
--commission-bps ${commissionBps} \\
--rpc-bind-address 0.0.0.0 \\
--block-engine-url ${blockEngineUrl} \\
--shred-receiver-address ${shredReceiverAddr} \\
--bam-url ${bamUrl} \\
--dynamic-port-range 8000-8025 \\
--rpc-port 8899 \\
--wal-recovery-mode skip_any_corrupted_record \\
--limit-ledger-size 50000000 \\
--block-production-method central-scheduler-greedy \\
--block-verification-method unified-scheduler \\
--maximum-full-snapshots-to-retain 1 \\
--maximum-incremental-snapshots-to-retain 2 \\
--expected-shred-version 41708 \\
--expected-bank-hash 4NuNyboT36pwwGJvMPZLreFqYpkbpBjX82nkt4AkJ9QT \\
--expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\
`
  return script
}
