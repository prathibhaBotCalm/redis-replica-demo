variable "digitalocean_token" {
  description = "DigitalOcean API token"
  type        = string
}

variable "ssh_key_name" {
  description = "Name of the SSH key as it should appear in DigitalOcean"
  type        = string
}

variable "public_key_path" {
  description = "Local path to your SSH public key"
  type        = string
}

variable "droplet_image" {
  description = "The image to use for the droplet"
  type        = string
  default     = "ubuntu-20-04-x64"
}

variable "droplet_name" {
  description = "The name of the droplet"
  type        = string
  default     = "redis-live-demo"
}

variable "region" {
  description = "The DigitalOcean region to deploy in"
  type        = string
  default     = "sgp1"
}

variable "droplet_size" {
  description = "The droplet size (plan) to use"
  type        = string
  default     = "s-1vcpu-1gb"
}

variable "tags" {
  description = "Tags to assign to the droplet"
  type        = list(string)
  default     = ["redis", "app"]
}
