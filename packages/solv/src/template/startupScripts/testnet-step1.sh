#!/bin/bash
sudo apt update && sudo apt upgrade -y

# update solv
solv update && solv update --config && solv i

# edit solv4.config.json
echo '{
  "NETWORK": "testnet",
  "NODE_TYPE": "validator",
  "VALIDATOR_TYPE": "agave",
  "RPC_TYPE": "none",
  "MNT_DISK_TYPE": "triple",
  "TESTNET_SOLANA_VERSION": "2.1.6",
  "MAINNET_SOLANA_VERSION": "2.0.19",
  "NODE_VERSION": "20.17.0",
  "TESTNET_DELINQUENT_STAKE": 5,
  "MAINNET_DELINQUENT_STAKE": 5,
  "COMMISSION": 100,
  "DEFAULT_VALIDATOR_VOTE_ACCOUNT_PUBKEY": "ELLB9W7ZCwRCV3FzWcCWoyKP6NjZJKArLyGtkqefnHcG",
  "STAKE_ACCOUNTS": [],
  "HARVEST_ACCOUNT": "",
  "IS_MEV_MODE": false,
  "RPC_URL": "https://api.mainnet-beta.solana.com",
  "KEYPAIR_PATH": "",
  "DISCORD_WEBHOOK_URL": "",
  "AUTO_UPDATE": false,
  "AUTO_RESTART": false,
  "IS_DUMMY": false,
  "API_KEY": "",
  "LEDGER_PATH": "/mnt/ledger",
  "ACCOUNTS_PATH": "/mnt/accounts",
  "SNAPSHOTS_PATH": "/mnt/snapshots"
}' > solv4.config.json

# enable solv.service
sudo systemctl enable solv.service

# remove all existing snapshots
rm -rf /mnt/snapshots/snapshot-*
rm -rf /mnt/snapshots/incremental-*

# start-valdiator.sh
echo '#!/bin/bash
exec agave-validator \
--identity /home/solv/identity.json \
--vote-account /home/solv/testnet-vote-account-keypair.json \
--authorized-voter  /home/solv/testnet-validator-keypair.json \
--log /home/solv/solana-validator.log \
--accounts /mnt/accounts \
--ledger /mnt/ledger \
--snapshots /mnt/snapshots \
--entrypoint entrypoint.testnet.solana.com:8001 \
--entrypoint entrypoint2.testnet.solana.com:8001 \
--entrypoint entrypoint3.testnet.solana.com:8001 \
--known-validator 5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on \
--only-known-rpc \
--rpc-bind-address 127.0.0.1 \
--private-rpc \
--expected-genesis-hash 4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY \
--dynamic-port-range 8000-8020 \
--rpc-port 8899 \
--wal-recovery-mode skip_any_corrupted_record \
--wait-for-supermajority 312256121 \
--expected-shred-version 64475 \
--expected-bank-hash 6A7U1X8WqnWRXWtqaxF15sSYHLT66j1ycBEyFigGwr2Z \
--limit-ledger-size \
--block-production-method central-scheduler \
--block-verification-method unified-scheduler \
--full-rpc-api \' > start-validator.sh

# start and wait for snapshots to downlaod
solv start && solv log