const AGAVE_CLI = 'agave-validator -l /mnt/ledger'
const FD_CLI = 'sudo fdctl --config /home/solv/firedancer/config.toml'

const getSolanaCLIActive = (client: string) => {
  if(client === "agave") {
    return AGAVE_CLI
  } else {
    return FD_CLI
  }
}
export default getSolanaCLIActive
