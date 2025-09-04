import {
  IDENTITY_KEY_PATH,
  LOG_PATH,
  TESTNET_VALIDATOR_KEY_PATH,
  TESTNET_VALIDATOR_VOTE_KEY_PATH,
} from '@/config/constants'
import { DefaultConfigType } from '@/config/types'

export const startTestnetAgaveValidatorScript = (config: DefaultConfigType) => {
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
--known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \\
--known-validator phz4F5mHZcZGC21GRUT6j3AqJxTUGDVAiCKiyucnyy1 \\
--known-validator rad1u8GKZoyVWxVAKy1cjL84dqhS9mp57uAezPt4iQg \\
--only-known-rpc \\
--rpc-bind-address 127.0.0.1 \\
--private-rpc \\
--expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\
--dynamic-port-range 8000-8025 \\
--rpc-port 8899 \\
--wal-recovery-mode skip_any_corrupted_record \\
--wait-for-supermajority 343175553 \\
--expected-shred-version 9065 \\
--expected-bank-hash 4oMrSXsLTiCc1X7S27kxSfGVraTCZoZ7YTy2skEB9bPk \\
--limit-ledger-size 50000000 \\
--block-production-method central-scheduler-greedy \\
--block-verification-method unified-scheduler \\
--full-rpc-api \\
`
  return script
}
