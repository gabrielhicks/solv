const configToml = () => {
  const filePath = '/home/solv/firedancer/config.toml'
  const body = `
name = \"fd1\"
user = \"solv\"

[log]
    path = \"/home/solv/solana-validator.log\"
    colorize = \"auto\"
    level_logfile = \"INFO\"
    level_stderr = \"NOTICE\"
    level_flush = \"WARNING\"

[reporting]
    solana_metrics_config = \"host=https://metrics.solana.com:8086,db=tds,u=testnet_write,p=c4fa841aa918bf8274e3e2a44d77568d9861b3ea\"

[ledger]
    path = \"/mnt/ledger\"
    accounts_path = \"/mnt/accounts\"
    account_indexes = []
    account_index_exclude_keys = []
    snapshot_archive_format = \"zstd\"
    require_tower = false

[snapshots]
    incremental_snapshots = false
    path = \"/mnt/snapshots\"

[gossip]
    entrypoints = [
        \"entrypoint.testnet.solana.com:8001\",
        \"entrypoint2.testnet.solana.com:8001\",
        \"entrypoint3.testnet.solana.com:8001\"
    ]

[consensus]
    identity_path = \"/home/solv/identity.json\"
    vote_account_path = \"/home/solv/testnet-vote-account-keypair.json\"
    authorized_voter_paths = [
        \"/home/solv/testnet-validator-keypair.json\"
    ]
    expected_genesis_hash = \"4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY\"
    wait_for_supermajority_at_slot = 306450862
    expected_bank_hash = \"BiGFLfFewfTB2asBRLjwRL6z7VNfuvYraS3H7RfQNCrf\"
    expected_shred_version = 64506
    known_validators = [
        \"5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on\", 
        \"dDzy5SR3AXdYWVqbDEkVFdvSPCtS9ihF5kJkHCtXoFs\",
        \"Ft5fbkqNa76vnsjYNwjDZUXoTWpP7VYm3mtsaQckQADN\",
        \"eoKpUABi59aT4rR9HGS3LcMecfut9x7zJyodWWP43YQ\",
        \"9QxCLckBiJc783jnMvXZubK4wH86Eqqvashtrwvcsgkv\"
    ]

[rpc]
    port = 8899
    only_known = true
    full_api = true
    private = true

[layout]
   affinity = \"auto\"
   agave_affinity = \"auto\"
   shred_tile_count = 1
   verify_tile_count = 1
   bank_tile_count = 1
   quic_tile_count = 1
`;

  return { filePath, body }
}

export default configToml
