import {
  ACCOUNTS_PATH,
  IDENTITY_KEY_PATH,
  LEDGER_PATH,
  LOG_PATH,
  TESTNET_VALIDATOR_KEY_PATH,
  TESTNET_VALIDATOR_VOTE_KEY_PATH,
} from '@/config/constants'

export const startTestnetValidatorScript = () => {
  const script = `#!/bin/bash
exec agave-validator \\
--identity ${IDENTITY_KEY_PATH} \\
--vote-account ${TESTNET_VALIDATOR_VOTE_KEY_PATH} \\
--authorized-voter  ${TESTNET_VALIDATOR_KEY_PATH} \\
--log ${LOG_PATH} \\
--accounts ${ACCOUNTS_PATH} \\
--ledger ${LEDGER_PATH} \\
--entrypoint entrypoint.testnet.solana.com:8001 \\
--entrypoint entrypoint2.testnet.solana.com:8001 \\
--entrypoint entrypoint3.testnet.solana.com:8001 \\
--known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \\
--known-validator phz4F5mHZcZGC21GRUT6j3AqJxTUGDVAiCKiyucnyy1 \\
--known-validator rad1u8GKZoyVWxVAKy1cjL84dqhS9mp57uAezPt4iQg \\
--only-known-rpc \\
--expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \\
--dynamic-port-range 8000-8020 \\
--rpc-port 8899 \\
--wal-recovery-mode skip_any_corrupted_record \\
--wait-for-supermajority 343175553 \\
--expected-shred-version 9065 \\
--expected-bank-hash 4oMrSXsLTiCc1X7S27kxSfGVraTCZoZ7YTy2skEB9bPk \\
--use-snapshot-archives-at-startup when-newest \\
--limit-ledger-size 50000000 \\
--block-production-method central-scheduler-greedy \\
`
  return script
}
