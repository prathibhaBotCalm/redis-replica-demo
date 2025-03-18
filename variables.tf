variable "do_token" {
  description = "Digital Ocean API Token"
  type        = string
  sensitive   = true
}

variable "ssh_key_name" {
  description = "Name of the SSH key in Digital Ocean"
  type        = string
  default     = "terraform-key"
}

variable "ssh_public_key_path" {
  description = "Path to the public SSH key"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "ssh_private_key_path" {
  description = "Path to the private SSH key for provisioning"
  type        = string
  default     = "~/.ssh/id_rsa"
}

variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "my-app"
}

variable "droplet_count" {
  description = "Number of droplets to create"
  type        = number
  default     = 2
}

variable "droplet_image" {
  description = "Droplet image ID or slug"
  type        = string
  default     = "ubuntu-22-04-x64"
}

variable "droplet_size" {
  description = "Droplet size slug"
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "region" {
  description = "DigitalOcean region"
  type        = string
  default     = "nyc1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.118.0.0/20"  # Using a CIDR range that doesn't conflict with DO internal networks
}

variable "environment" {
  description = "Environment (development, staging, production)"
  type        = string
  default     = "development"
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "Environment must be one of: development, staging, production."
  }
}

variable "create_loadbalancer" {
  description = "Whether to create a load balancer"
  type        = bool
  default     = false
}

variable "allowed_ssh_ips" {
  description = "List of IP addresses allowed to connect via SSH"
  type        = list(string)
  default     = ["0.0.0.0/0"] # Open to all by default, consider restricting in production
}

variable "use_existing_ssh_key" {
  description = "Whether to use an existing SSH key instead of creating a new one"
  type        = bool
  default     = true
}