import { program } from '@/index'
import { DefaultConfigType } from '@/config/types'
import { updateLogrotate } from '../setup/updateLogrotate'

export const logrotateCommand = (config: DefaultConfigType) => {
  program
    .command('logrotate')
    .description('Refresh Logrotate')
    .action(() => {
      const isFiredancer = config.VALIDATOR_TYPE === 'frankendancer';
      updateLogrotate(isFiredancer)
      process.exit(0)
    })
}
