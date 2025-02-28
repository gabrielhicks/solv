const AGAVE_CLI = 'agave-validator -l /mnt/ledger'

const getSolanaCLIAgave = () => {
  try {
    return AGAVE_CLI
  } catch (error) {
    console.error(error)
    return AGAVE_CLI
  }
}
export default getSolanaCLIAgave
