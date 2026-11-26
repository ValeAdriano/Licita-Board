#!/usr/bin/env bash
# Prepara uma VPS NOVA (Ubuntu 24.04 LTS) para o VV Licitações (ADR-015, endurecimento). Roda NO SERVIDOR,
# como root, uma vez, logo depois de criar a máquina e de entrar por SSH com CHAVE.
#
# Uso: sudo bash infra/deploy/preparar-servidor.sh
#
# Faz: atualizações automáticas de segurança; Docker (repositório oficial); firewall só com SSH, 80 e 443;
# SSH só por chave; swap de 2 GB se não houver (o antivírus usa ~1,5 GB); pastas /opt/vv e /etc/vv.
# Não faz: DNS, usuário de deploy, cópia do repositório, segredos (ver docs/operacao/producao.md).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "rode como root (sudo)" >&2; exit 1; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "feito para Ubuntu; aqui é ${ID:-desconhecido}" >&2; exit 1; }

# Trava: sem chave SSH autorizada, desligar a senha do SSH trancaria você para fora.
if ! ls /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys 2>/dev/null | xargs -r cat | grep -q '^ssh-\|^ecdsa-'; then
  echo "nenhuma chave SSH autorizada encontrada: cadastre a sua antes (ssh-copy-id)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl gnupg ufw unattended-upgrades fail2ban git openssl

echo "== Atualizações automáticas de segurança"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Docker (repositório oficial)"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Logs dos containers com rotação (também definida no compose) e sem userland-proxy.
mkdir -p /etc/docker
[ -e /etc/docker/daemon.json ] || cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" }, "live-restore": true, "userland-proxy": false }
JSON
systemctl enable --now docker
systemctl restart docker

echo "== Firewall (SSH, 80, 443)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Atenção: o Docker publica portas por fora do ufw. Só o Caddy publica (80/443); nada mais no compose.

echo "== SSH só por chave"
cat > /etc/ssh/sshd_config.d/10-vv.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 3
CONF
sshd -t && systemctl reload ssh

echo "== Swap"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== Pastas"
install -d -m 0755 /opt/vv
install -d -m 0750 /etc/vv
install -d -m 0700 /etc/vv/segredos

cat <<'EOF'

Servidor pronto. Próximos passos (docs/operacao/producao.md):
  1. clonar o repositório em /opt/vv (chave de deploy só leitura)
  2. /etc/vv/vv.env a partir de infra/deploy/vv.env.example
  3. sudo infra/deploy/gerar-segredos.sh
  4. docker login ghcr.io (token só de leitura de pacotes)
  5. sudo infra/deploy/deploy.sh <versão>
EOF
