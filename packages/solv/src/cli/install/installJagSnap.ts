import { execSync, spawnSync } from 'node:child_process'
import jagsnapService from '../setup/template/firedancer/jagsnapService'
import jagsnapTimer from '../setup/template/firedancer/jagsnapTimer'

const installJagSnap = (region: string) => {
  const { filePath: servicePath, body: serviceBody } = jagsnapService(region)
  const { filePath: timerPath, body: timerBody } = jagsnapTimer(region)
  execSync(`echo "${serviceBody}" | sudo tee ${servicePath} > /dev/null`)
  execSync(`echo "${timerBody}" | sudo tee ${timerPath} > /dev/null`)
  spawnSync(
    `git clone https://github.com/gabrielhicks/jag-snap.git /home/solv/jag-snap`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(`cd /home/solv/jag-snap`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo apt install ipset iptables -y`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo iptables -A INPUT -p tcp --dport 18899 -j ACCEPT`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(
    `sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(`sudo ufw allow 18899/tcp`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo ufw reload`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(
    `cd /home/solv/jag-snap && docker build -t jag-snap . && docker run -d --name jag-snap --network host jag-snap`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
}

export default installJagSnap
