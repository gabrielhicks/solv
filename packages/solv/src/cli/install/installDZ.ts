import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'fs'

// Agave Install e.g. installDZ('0.1.0')
const installDZ = (version: string, isTestnet: boolean) => {
  if(isTestnet) {
    spawnSync(`curl -1sLf https://dl.cloudsmith.io/public/malbeclabs/doublezero/setup.deb.sh | sudo -E bash`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt-get install doublezero=${version} -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `sudo mkdir -p /etc/systemd/system/doublezerod.service.d`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    const testnetOverrideConfig = `[Service]
ExecStart=
ExecStart=/usr/bin/doublezerod -sock-file /run/doublezerod/doublezerod.sock -env testnet -metrics-enable -metrics-addr localhost:2113
`
    writeFileSync('/tmp/doublezerod-override.conf', testnetOverrideConfig, 'utf-8')
    spawnSync(
      `sudo mv /tmp/doublezerod-override.conf /etc/systemd/system/doublezerod.service.d/override.conf`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `sudo chmod 644 /etc/systemd/system/doublezerod.service.d/override.conf`,
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
      `sudo systemctl restart doublezerod`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `doublezero config set --env testnet  > /dev/null`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `echo "✅ doublezerod configured for environment testnet"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`mkdir -p ~/.config/doublezero && ln -s /home/solv/testnet-validator-keypair.json ~/.config/doublezero/id.json`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo sed -i '/# drop INVALID packets (logs these in loglevel medium and higher)/i # gre\n-A ufw-before-input -p 47 -j ACCEPT\n-A ufw-before-output -p 47 -j ACCEPT' /etc/ufw/before.rules`, {
      shell: true,
      stdio: 'inherit',
    })
  } else {
    spawnSync(`curl -1sLf https://dl.cloudsmith.io/public/malbeclabs/doublezero/setup.deb.sh | sudo -E bash`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo apt-get install doublezero=${version} -y`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(
      `sudo mkdir -p /etc/systemd/system/doublezerod.service.d`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    const mainnetOverrideConfig = `[Service]
ExecStart=
ExecStart=/usr/bin/doublezerod -sock-file /run/doublezerod/doublezerod.sock -env mainnet-beta -metrics-enable -metrics-addr localhost:2113
`
    writeFileSync('/tmp/doublezerod-override.conf', mainnetOverrideConfig, 'utf-8')
    spawnSync(
      `sudo mv /tmp/doublezerod-override.conf /etc/systemd/system/doublezerod.service.d/override.conf`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `sudo chmod 644 /etc/systemd/system/doublezerod.service.d/override.conf`,
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
      `sudo systemctl restart doublezerod`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `doublezero config set --env mainnet-beta  > /dev/null`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(
      `echo "✅ doublezerod configured for environment mainnet-beta"`,
      {
        shell: true,
        stdio: 'inherit',
      },
    )
    spawnSync(`mkdir -p ~/.config/doublezero && ln -s /home/solv/mainnet-validator-keypair.json ~/.config/doublezero/id.json`, {
      shell: true,
      stdio: 'inherit',
    })
    spawnSync(`sudo sed -i '/# drop INVALID packets (logs these in loglevel medium and higher)/i # gre\n-A ufw-before-input -p 47 -j ACCEPT\n-A ufw-before-output -p 47 -j ACCEPT' /etc/ufw/before.rules`, {
      shell: true,
      stdio: 'inherit',
    })
  }
  spawnSync(`sudo systemctl daemon-reload`, {
    shell: true,
    stdio: 'inherit',
  })
  spawnSync(`sudo systemctl restart doublezerod`, {
    shell: true,
    stdio: 'inherit',
  })
}

export default installDZ
