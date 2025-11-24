import { setupSystemd } from '@/cli/setup/setupSystemd'
import { setupLogrotate } from './setupLogrotate'
import { setupSolvService } from './setupSolvService'
import { setupFiredancerService } from './setupFiredancerService'

export const makeServices = (isTest: boolean, isFiredancer: boolean) => {
  setupLogrotate(isFiredancer)
  setupSolvService(isTest)
  setupFiredancerService()
  setupSystemd()
}
