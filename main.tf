terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

provider "digitalocean" {
  token = var.digitalocean_token
}

#############################
# SSH Key Setup
#############################
resource "digitalocean_ssh_key" "default" {
  name       = var.ssh_key_name
  public_key = file(var.public_key_path)
}

#############################
# Droplet Creation
#############################
resource "digitalocean_droplet" "app" {
  image    = var.droplet_image
  name     = var.droplet_name
  region   = var.region
  size     = var.droplet_size
  ssh_keys = [digitalocean_ssh_key.default.fingerprint]
  tags     = var.tags

  # User data installs Docker and Docker Compose on first boot.
  user_data = <<-EOF
    #!/bin/bash
    apt-get update -y
    apt-get install -y docker.io docker-compose
    systemctl start docker
    systemctl enable docker
  EOF
}

#############################
# Firewall Configuration
#############################
resource "digitalocean_firewall" "app_firewall" {
  name        = "app-firewall"
  droplet_ids = [digitalocean_droplet.app.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0"]
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "all"
    destination_addresses = ["0.0.0.0/0"]
  }
}

#############################
# Outputs
#############################
output "droplet_ip" {
  description = "The public IPv4 address of the droplet"
  value       = digitalocean_droplet.app.ipv4_address
}
