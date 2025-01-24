#!/bin/bash

# stop after snapshot and incremental are downloaded
solv stop

# move snapshots back a directory
mv /mnt/snapshots/remote/* /mnt/snapshots

# update to 2.0.22
solv i --version 2.0.22

# replace solv4.json.config again
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
--rpc-bind-address 0.0.0.0 \
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
--no-snapshot-fetch \' > start-validator.sh

# start again
solv start && solv log