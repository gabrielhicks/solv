import { JitoConfig } from "@/config/jitConfig"

const configToml = (isTest: boolean, jitoConfig: JitoConfig) => {
  const filePath = '/home/solv/firedancer/config.toml'
  const mainnetBody = `name = \"fd1\"
user = \"solv\"

[log]
    path = \"/home/solv/solana-validator.log\"
    colorize = \"auto\"
    level_logfile = \"INFO\"
    level_stderr = \"NOTICE\"
    level_flush = \"WARNING\"

[reporting]
    solana_metrics_config = \"host=https://metrics.solana.com:8086,db=mainnet-beta,u=mainnet-beta_write,p=password"

[ledger]
    path = \"/mnt/ledger\"
    accounts_path = \"/mnt/accounts\"
    account_indexes = []
    account_index_exclude_keys = []
    snapshot_archive_format = \"zstd\"
    require_tower = false
    limit_size = 50_000_000
    enable_accounts_disk_index = false

[snapshots]
    enabled = true
    incremental_snapshots = true
    path = \"/mnt/snapshots\"
    incremental_path = \"/mnt/snapshots\"
    maximum_full_snapshots_to_retain = 1
    maximum_incremental_snapshots_to_retain = 2

[gossip]
    entrypoints = [
        \"entrypoint.mainnet-beta.solana.com:8001\",
        \"entrypoint2.mainnet-beta.solana.com:8001\",
        \"entrypoint3.mainnet-beta.solana.com:8001\",
        \"entrypoint4.mainnet-beta.solana.com:8001\",
        \"entrypoint5.mainnet-beta.solana.com:8001\"
    ]

[consensus]
    identity_path = \"/home/solv/identity.json\"
    vote_account_path = \"/home/solv/mainnet-vote-account-keypair.json\"
    authorized_voter_paths = [
        \"/home/solv/mainnet-validator-keypair.json\"
    ]
    expected_genesis_hash = \"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d\"
    known_validators = [
        \"Certusm1sa411sMpV9FPqU5dXAYhmmhygvxJ23S6hJ24\", 
        \"7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2\",
        \"GdnSyH3YtwcxFvQrVVJMm1JhTS4QVX7MFsX56uJLUfiZ\",
        \"CakcnaRDHka2gXyfbEd2d3xsvkJkqsLw2akB3zsN1D2S\",
        \"rad1u8GKZoyVWxVAKy1cjL84dqhS9mp57uAezPt4iQg\",
        \"phz4F5mHZcZGC21GRUT6j3AqJxTUGDVAiCKiyucnyy1\",
        \"wetkjRRRDrSPAzHqfVHtFDbhNnejKm5UPfkHeccFCpo\",
        \"YE11a5nVJtUNqsojkphYuWc7StqBzbCeFH6BjhAAUEV\",
        \"dmMwc4RazLHkvDZYrWAfbHQ6cViAvNa5szCJKaiun8S\"
    ]

[rpc]
    port = 8899
    only_known = true
    full_api = true
    private = true

[layout]
   affinity = \"auto\"
   agave_affinity = \"auto\"
   net_tile_count = 1
   quic_tile_count = 1
   verify_tile_count = 6
   bank_tile_count = 4
   shred_tile_count = 1

[tiles.bundle]
    enabled = true
    url = \"${jitoConfig.blockEngineUrl}\"
    tip_distribution_program_addr = \"4R3gSG8BpU4t19KYj8CfnbtRpnT8gtk4dvTHxVRwc2r7\"
    tip_payment_program_addr = \"T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt\"
    tip_distribution_authority = \"GZctHpWXmsZC1YHACTGGcHhYxjdRqQvTpYkb9LMvxDib\"
    commission_bps = 0

[tiles.pack]
  schedule_strategy = \"balanced\"

[net]
  provider = \"socket\"`

  const testnetBody = `name = \"fd1\"
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
    limit_size = 50_000_000

[snapshots]
    enabled = true
    incremental_snapshots = true
    path = \"/mnt/snapshots\"
    maximum_full_snapshots_to_retain = 1
    maximum_incremental_snapshots_to_retain = 2

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
    expected_bank_hash = \"EJMzxv7JscF8WNZfDYqzsAyALCDCS52HuihabVgyz5mf\"
    expected_shred_version = 9604
    wait_for_supermajority_at_slot = 374301609
    known_validators = [
        \"5D1fNXzvv5NjV1ysLjirC4WY92RNsVH18vjmcszZd8on\", 
        \"dDzy5SR3AXdYWVqbDEkVFdvSPCtS9ihF5kJkHCtXoFs\",
        \"Ft5fbkqNa76vnsjYNwjDZUXoTWpP7VYm3mtsaQckQADN\",
        \"eoKpUABi59aT4rR9HGS3LcMecfut9x7zJyodWWP43YQ\",
        \"rad1u8GKZoyVWxVAKy1cjL84dqhS9mp57uAezPt4iQg\",
        \"phz4F5mHZcZGC21GRUT6j3AqJxTUGDVAiCKiyucnyy1\",
        \"hxTzWqz2WMdLhbMgYfsWiWYdtx8pY582FKwQpfGL59M\",
        \"naterTR45j7aWs16S3qx8V29CfM314dzfvtCSitiAYi\",
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
   
[tiles.bundle]
    enabled = true
    url = \"https://ny.testnet.block-engine.jito.wtf\"
    tip_distribution_program_addr = \"F2Zu7QZiTYUhPd7u9ukRVwxh7B71oA3NMJcHuCHc29P2\"
    tip_payment_program_addr = \"GJHtFqM9agxPmkeKjHny6qiRKrXZALvvFGiKf11QE7hy\"
    tip_distribution_authority = \"GZctHpWXmsZC1YHACTGGcHhYxjdRqQvTpYkb9LMvxDib\"
    commission_bps = 10000

[tiles.pack]
  schedule_strategy = \"balanced\"`

    const body = isTest ? testnetBody : mainnetBody

  return { filePath, body }
}

export default configToml
