#!/bin/bash
set -e

# Update system
apt-get update
apt-get upgrade -y

# Install common packages
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    ufw \
    git \
    nginx

# Configure firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Install Docker if needed
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable docker
    systemctl start docker
fi

# Setup Docker Compose if needed
if ! command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
    curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# Create app directory
mkdir -p /var/www/app

# Configure Nginx as reverse proxy
cat > /etc/nginx/sites-available/app << 'EOL'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOL

# Enable the site
ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/

# Test Nginx configuration
nginx -t

# Restart Nginx
systemctl restart nginx

# Create a system user for the application
useradd -m -s /bin/bash -U app-user

# Setup log rotation
cat > /etc/logrotate.d/app << 'EOL'
/var/log/app/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 app-user app-user
    sharedscripts
    postrotate
        systemctl reload nginx
    endscript
}
EOL

echo "Server setup completed successfully!"