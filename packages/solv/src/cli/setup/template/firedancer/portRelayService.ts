const portRelayService = () => {
  const filePath = '/etc/systemd/system/port-relay.service'
  const body = `[Unit]
Description=Relay port 9600 to localhost:80
After=network.target

[Service]
ExecStart=/usr/bin/socat TCP4-LISTEN:9600,reuseaddr,fork TCP:127.0.0.1:80
Restart=always

[Install]
WantedBy=multi-user.target
`

  return {
    filePath,
    body,
  }
}

export default portRelayService
