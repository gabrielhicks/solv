const AGAVE_CLI = 'agave-validator -l /mnt/ledger'
const FD_CLI = 'sudo fdctl'
const FC_CLI_CONFIG = '--config /home/solv/firedancer/config.toml '

const getSolanaCLIActive = (client: string) => {
  if(client === "agave") {
    return [AGAVE_CLI, '']
  } else {
    return [FD_CLI, FC_CLI_CONFIG]
  }
}
export default getSolanaCLIActive
