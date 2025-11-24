import { execAsync } from '@skeet-framework/utils'
import chalk from 'chalk'


export const syncFirewall = async () => {
  await execAsync(`echo "yes" | sudo ufw restart`)
  await execAsync(`echo "yes" | sudo ufw enable`)
  await execAsync(`sudo ufw allow ssh`)
  await execAsync(`sudo ufw allow 53`)
  await execAsync(`sudo ufw allow 8899/udp`)
  await execAsync(`sudo ufw allow 8899/tcp`)
  await execAsync(`sudo ufw allow 8000:8898/udp`)
  await execAsync(`sudo ufw allow 8000:8898/tcp`)
  await execAsync(`sudo ufw allow 8900:10000/tcp`)
  await execAsync(`sudo ufw allow 8900:10000/udp`)
  await execAsync(`sudo ufw allow 179/tcp`)
  await execAsync(`sudo ufw allow 9600/tcp`)
  await execAsync(`sudo ufw reload`)
  console.log(chalk.white('✔️ Firewall updated!'))
}
