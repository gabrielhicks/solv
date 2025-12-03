import { execSync, spawnSync } from 'node:child_process'
import jagsnapService from '../setup/template/firedancer/jagsnapService'
import jagsnapTimer from '../setup/template/firedancer/jagsnapTimer'

const installJagSnap = (region: string) => {
  const {filePath: servicePath, body: serviceBody} = jagsnapService(region)
  const {filePath: timerPath, body: timerBody} = jagsnapTimer(region)
  execSync(`echo "${serviceBody}" | sudo tee ${servicePath} > /dev/null`)
  execSync(`echo "${timerBody}" | sudo tee ${timerPath} > /dev/null`)
  spawnSync(
    `git clone https://github.com/jaguar-labs/jag-snap.git /home/solv/jag-snap`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(`cd /home/solv/jag-snap`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(
    `sudo cp /home/solv/jag-snap/jag-snap-fw.sh /usr/local/bin/`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo chown solv:solv /usr/local/bin/jag-snap-fw.sh`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo chmod 755 /usr/local/bin/jag-snap-fw.sh`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo useradd -m -s /bin/false jag-snap-fw`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo touch /etc/sudoers.d/jag-snap-fw`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `echo "jag-snap-fw ALL=(root) NOPASSWD: /sbin/iptables, /sbin/ipset" | sudo tee /etc/sudoers.d/jag-snap-fw > /dev/null`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo chmod 440 /etc/sudoers.d/jag-snap-fw`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo chmod 644 /etc/systemd/system/jag-snap-fw.service`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo chmod 644 /etc/systemd/system/jag-snap-fw.timer`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo systemctl daemon-reload`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo systemctl enable jag-snap-fw.timer`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `sudo systemctl start jag-snap-fw.timer`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
  spawnSync(
    `cd /home/solv/jag-snap && docker build -t jag-snap . && docker run -d --name jag-snap --network host jag-snap`,
    {
      shell: true,
      stdio: 'inherit',
    },
  )
}

export default installJagSnap
