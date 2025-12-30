# Setup, install, configure chrony file
```
sudo systemctl stop systemd-timesyncd
sudo systemctl disable systemd-timesyncd
sudo apt update
sudo apt install chrony -y
sudo systemctl enable chrony
sudo systemctl start chrony
sudo rm /etc/chrony/chrony.conf
sudo touch /etc/chrony/chrony.conf
sudo vim /etc/chrony/chrony.conf
```

# Use configuration based on cluster and physical location
Located in mainnet and testnet directories

# After creating/editing chrony.conf, apply following commands
```
sudo systemctl restart chrony
chronyc sources -v
chronyc tracking
chronyc sourcestats -v
sudo sed -i 's/^\(\s*search:\)/#\1/g' /etc/netplan/50-cloud-init.yaml
sudo sed -i 's/^\(\s*.*maas.*\)/#\1/g' /etc/netplan/50-cloud-init.yaml
sudo netplan apply
sudo cat /etc/netplan/50-cloud-init.yaml
```