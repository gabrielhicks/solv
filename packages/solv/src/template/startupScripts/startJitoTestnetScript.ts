import {
  IDENTITY_KEY_PATH,
  LOG_PATH,
  TESTNET_VALIDATOR_KEY_PATH,
  TESTNET_VALIDATOR_VOTE_KEY_PATH,
} from '@/config/constants'
import { DefaultConfigType } from '@/config/types'

export const startJitoTestnetScript = (
  commissionBps = 1000,
  relayerUrl: string,
  blockEngineUrl: string,
  shredReceiverAddr: string,
  config: DefaultConfigType,
  solanaCLI = 'agave-validator',
) => {
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
--known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \\
--known-validator phz4F5mHZcZGC21GRUT6j3AqJxTUGDVAiCKiyucnyy1 \\
--known-validator rad1u8GKZoyVWxVAKy1cjL84dqhS9mp57uAezPt4iQg \\
--tip-payment-program-pubkey GJHtFqM9agxPmkeKjHny6qiRKrXZALvvFGiKf11QE7hy \\
--tip-distribution-program-pubkey F2Zu7QZiTYUhPd7u9ukRVwxh7B71oA3NMJcHuCHc29P2 \\
--merkle-root-upload-authority GZctHpWXmsZC1YHACTGGcHhYxjdRqQvTpYkb9LMvxDib \\
--commission-bps ${commissionBps} \\
--rpc-bind-address 127.0.0.1 \\
--block-engine-url ${blockEngineUrl} \\
--shred-receiver-address ${shredReceiverAddr} \\
--dynamic-port-range 8000-8025 \\
--rpc-port 8899 \\
--wal-recovery-mode skip_any_corrupted_record \\
--limit-ledger-size 50000000 \\
--block-production-method central-scheduler-greedy \\
--block-verification-method unified-scheduler \\
--private-rpc \\
--wait-for-supermajority 343175553 \\
--expected-shred-version 9065 \\
--expected-bank-hash 4oMrSXsLTiCc1X7S27kxSfGVraTCZoZ7YTy2skEB9bPk \\
--expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\
--full-rpc-api \\
`
  return script
}
