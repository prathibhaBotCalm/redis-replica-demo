terraform {
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

# Configure the DigitalOcean Provider
provider "digitalocean" {
  token = var.do_token
}

# Create a new SSH key
resource "digitalocean_ssh_key" "default" {
  name       = var.ssh_key_name
  public_key = file(var.ssh_public_key_path)
}

# Create a new Droplet
resource "digitalocean_droplet" "web" {
  count    = var.droplet_count
  image    = var.droplet_image
  name     = "${var.project_name}-droplet-${count.index + 1}"
  region   = var.region
  size     = var.droplet_size
  ssh_keys = [digitalocean_ssh_key.default.fingerprint]
  tags     = ["web", var.project_name]

  # VPC configuration
  vpc_uuid = digitalocean_vpc.app_network.id

  # User data can be used for initial server setup
  user_data = file("${path.module}/scripts/setup.sh")

  # Wait for droplet to be active before considering the creation complete
  provisioner "remote-exec" {
    inline = ["echo 'Droplet is now available!'"]
    
    connection {
      type        = "ssh"
      user        = "root"
      host        = self.ipv4_address
      private_key = file(var.ssh_private_key_path)
    }
  }
}

# Create a VPC for network isolation
resource "digitalocean_vpc" "app_network" {
  name        = "${var.project_name}-network"
  region      = var.region
  description = "VPC for ${var.project_name} application"
  ip_range    = var.vpc_cidr
}

# Create a project to organize resources
resource "digitalocean_project" "project" {
  name        = var.project_name
  description = "${var.project_name} Project Resources"
  purpose     = "Web Application"
  environment = var.environment

  # Add all resources to project
  resources = concat(
    [for droplet in digitalocean_droplet.web : droplet.urn]
  )
}

# Optional: Create a load balancer if needed
resource "digitalocean_loadbalancer" "public" {
  count   = var.create_loadbalancer ? 1 : 0
  name    = "${var.project_name}-lb"
  region  = var.region
  vpc_uuid = digitalocean_vpc.app_network.id

  forwarding_rule {
    entry_port     = 80
    entry_protocol = "http"
    
    target_port     = 80
    target_protocol = "http"
  }

  forwarding_rule {
    entry_port     = 443
    entry_protocol = "https"
    
    target_port     = 443
    target_protocol = "https"
  }

  healthcheck {
    port     = 22
    protocol = "tcp"
  }

  droplet_ids = digitalocean_droplet.web[*].id
}

# Optional: Create a firewall to control traffic
resource "digitalocean_firewall" "web" {
  name = "${var.project_name}-firewall"

  # Droplets to apply the firewall to
  droplet_ids = digitalocean_droplet.web[*].id

  # Allow SSH from anywhere
  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = var.allowed_ssh_ips
  }

  # Allow HTTP from anywhere
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Allow HTTPS from anywhere
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  # Allow all outbound traffic
  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Output the IP addresses of the created droplets
output "droplet_ip_addresses" {
  value = {
    for i, droplet in digitalocean_droplet.web :
    droplet.name => droplet.ipv4_address
  }
}

# Output load balancer IP if created
output "loadbalancer_ip" {
  value = var.create_loadbalancer ? digitalocean_loadbalancer.public[0].ip : null
}