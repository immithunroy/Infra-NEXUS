#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/olt-commander
BACKEND_DIR=$APP_DIR/backend
FRONTEND_DIR=$APP_DIR/frontend
SRC_DIR=/tmp/olt-src

log(){ echo -e "\n===== $* ====="; }

log "Renaming host to olt-commander"
hostnamectl set-hostname olt-commander
echo "olt-commander" > /etc/hostname
grep -q "127.0.1.1.*olt-commander" /etc/hosts || sed -i "s/127.0.1.1.*/127.0.1.1 olt-commander/" /etc/hosts

log "Removing previous deployment"
systemctl stop isp-backend isp-frontend 2>/dev/null || true
systemctl disable isp-backend isp-frontend 2>/dev/null || true
rm -f /etc/systemd/system/isp-backend.service /etc/systemd/system/isp-frontend.service
rm -rf /opt/ISP_Opps /usr/share/isp-opps /var/lib/isp-opps /var/log/isp-opps
systemctl daemon-reload
if command -v mongod >/dev/null 2>&1; then
  systemctl stop mongodb 2>/dev/null || true
  apt-get purge -y mongodb* 2>/dev/null || true
fi

log "Updating package lists"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y

log "Installing system packages"
apt-get install -y --no-install-recommends \
  postgresql postgresql-contrib \
  nginx \
  curl ca-certificates gnupg \
  python3 python3-dev python3-venv python3-pip \
  build-essential libpq-dev git unzip openssl

log "Installing Node.js 20 from NodeSource"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

log "Preparing application directories"
mkdir -p $APP_DIR
rm -rf $BACKEND_DIR $FRONTEND_DIR
mkdir -p $BACKEND_DIR $FRONTEND_DIR

log "Extracting application source"
rm -rf $SRC_DIR
mkdir -p $SRC_DIR
tar -xzf /tmp/olt-commander-src.tgz -C $SRC_DIR
cp -r $SRC_DIR/backend/. $BACKEND_DIR/
cp -r $SRC_DIR/frontend/. $FRONTEND_DIR/
rm -rf $SRC_DIR

log "Configuring PostgreSQL"
systemctl enable postgresql
systemctl start postgresql
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_roles WHERE rolname='olt'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE ROLE olt LOGIN PASSWORD 'oltpassword'\""
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='olt_commander'\"" | grep -q 1 || \
  su - postgres -c "psql -c \"CREATE DATABASE olt_commander OWNER olt\""

log "Installing backend Python dependencies"
cd $BACKEND_DIR
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
cp .env.example .env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 24)|" .env

log "Building frontend"
cd $FRONTEND_DIR
npm install --no-audit --no-fund --loglevel=error
npm run build

log "Creating backend systemd service"
cat > /etc/systemd/system/olt-backend.service <<'EOF'
[Unit]
Description=OLT Commander Backend
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/olt-commander/backend
ExecStart=/opt/olt-commander/backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

log "Configuring nginx"
cat > /etc/nginx/sites-available/olt-commander <<'EOF'
server {
    listen 80 default_server;
    server_name _;

    root /opt/olt-commander/frontend/dist;
    index index.html;

    client_max_body_size 25m;

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/olt-commander /etc/nginx/sites-enabled/olt-commander
nginx -t
systemctl enable nginx
systemctl restart nginx

log "Enabling and starting services"
systemctl daemon-reload
systemctl enable olt-backend
systemctl restart olt-backend

log "Waiting for backend to come up"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
echo "Health: $(curl -fsS http://127.0.0.1:8080/api/health || echo 'FAILED')"

log "DEPLOY COMPLETE"
echo "Frontend : http://172.16.0.101"
echo "Backend  : http://172.16.0.101:8080/api"
echo "Hostname : $(hostname)"