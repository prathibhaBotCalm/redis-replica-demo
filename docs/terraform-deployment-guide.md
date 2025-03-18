# Digital Ocean Infrastructure Automation with Terraform

This documentation provides a comprehensive guide to set up and use the Terraform-based automation for Digital Ocean infrastructure.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Deployment Workflow](#deployment-workflow)
5. [Infrastructure Components](#infrastructure-components)
6. [Customization Options](#customization-options)
7. [Common Issues and Solutions](#common-issues-and-solutions)
8. [Best Practices](#best-practices)
9. [Maintenance and Updates](#maintenance-and-updates)

## Prerequisites

Before you begin, ensure you have the following:

- **Terraform** (v1.0.0 or later) installed
- **Digital Ocean** account
- **Digital Ocean API Token** with write permissions
- **SSH key pair** for secure access to your droplets

### Software Installation

#### Install Terraform

**macOS (using Homebrew):**

```bash
brew install terraform
```

**Linux (Ubuntu/Debian):**

```bash
sudo apt-get update && sudo apt-get install -y gnupg software-properties-common
wget -O- https://apt.releases.hashicorp.com/gpg | gpg --dearmor | sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install terraform
```

**Check installation:**

```bash
terraform --version
```

#### Generate SSH Key (if needed)

If you don't already have an SSH key pair:

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa
```

## Installation

1. **Clone or download the repository containing the configuration files**

2. **Create the project directory structure:**

   ```
   project/
   ├── main.tf
   ├── variables.tf
   ├── terraform.tfvars
   ├── deploy.sh
   └── scripts/
       └── setup.sh
   ```

3. **Make the deploy script executable:**

   ```bash
   chmod +x deploy.sh
   ```

## Configuration

### Digital Ocean API Token

1. **Create a Digital Ocean API token:**
   - Log in to your Digital Ocean account
   - Go to API > Personal access tokens
   - Click "Generate New Token"
   - Name your token (e.g., "Terraform")
   - Select "Write" scope
   - Copy the generated token immediately (it won't be shown again)

### Configure Terraform Variables

1. **Create your terraform.tfvars file:**

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

2. **Edit the terraform.tfvars file with your settings:**

   ```
   do_token             = "your_digital_ocean_api_token"
   project_name         = "my-application"
   ssh_key_name         = "my-ssh-key"
   ssh_public_key_path  = "~/.ssh/id_rsa.pub"
   ssh_private_key_path = "~/.ssh/id_rsa"
   droplet_count        = 2
   droplet_image        = "ubuntu-22-04-x64"
   droplet_size         = "s-2vcpu-2gb"
   region               = "nyc1"
   vpc_cidr             = "10.118.0.0/20"
   environment          = "development"
   create_loadbalancer  = true
   allowed_ssh_ips      = ["your_ip_address/32"]
   ```

   Replace the placeholder values with your actual configuration.

### Critical Configuration Parameters

| Parameter       | Description                                     | Example Value                             |
| --------------- | ----------------------------------------------- | ----------------------------------------- |
| do_token        | Your Digital Ocean API token                    | "dop*v1*..."                              |
| project_name    | Name for your project (affects resource naming) | "web-app"                                 |
| droplet_count   | Number of droplets to create                    | 2                                         |
| droplet_size    | Size of droplets                                | "s-2vcpu-2gb"                             |
| region          | Digital Ocean region                            | "nyc1" or "sfo3"                          |
| environment     | Deployment environment                          | "development", "staging", or "production" |
| allowed_ssh_ips | IPs allowed to SSH to your droplets             | ["123.45.67.89/32"]                       |

## Deployment Workflow

The deployment process is managed through the `deploy.sh` script, which provides a simple interface for Terraform operations.

### Basic Commands

1. **Initialize Terraform:**

   ```bash
   ./deploy.sh init
   ```

   This command initializes Terraform, downloads required providers, and checks SSH key configuration.

2. **Create a Deployment Plan:**

   ```bash
   ./deploy.sh plan
   ```

   This creates a plan of the resources to be created/modified without making actual changes.

3. **Apply the Changes:**

   ```bash
   ./deploy.sh apply
   ```

   This applies the plan and creates/updates your infrastructure.

4. **View Resource Outputs:**

   ```bash
   ./deploy.sh output
   ```

   Shows information about created resources, including IP addresses.

5. **Destroy Infrastructure:**

   ```bash
   ./deploy.sh destroy
   ```

   Removes all created resources from Digital Ocean.

### Deployment Lifecycle

A typical deployment workflow follows these steps:

1. **Initial setup:**

   ```bash
   # Configure variables
   cp terraform.tfvars.example terraform.tfvars
   nano terraform.tfvars  # Edit with your values

   # Initialize Terraform
   ./deploy.sh init
   ```

2. **First deployment:**

   ```bash
   ./deploy.sh plan
   ./deploy.sh apply
   ```

3. **View resource details:**

   ```bash
   ./deploy.sh output
   ```

4. **Make changes:**

   - Edit `terraform.tfvars` to change configuration
   - Run `./deploy.sh plan` to see what will change
   - Run `./deploy.sh apply` to apply changes

5. **Clean up:**

   ```bash
   ./deploy.sh destroy
   ```

## Infrastructure Components

This Terraform configuration creates the following resources in Digital Ocean:

### Core Infrastructure

- **Droplets**: Virtual machines running Ubuntu 22.04
- **VPC Network**: Private network for secure communication
- **SSH Keys**: Used for secure access to droplets
- **Project**: Logical organization of resources

### Optional Components

- **Load Balancer**: For distributing traffic (when `create_loadbalancer = true`)
- **Firewall**: Security rules for controlling traffic

### Server Configuration

Each droplet is configured with the `setup.sh` script that installs:

- Docker and Docker Compose
- Nginx as a reverse proxy
- Basic security configurations
- User accounts and permissions

## Customization Options

### Scaling

To adjust the size of your deployment:

1. **Change number of droplets:**

   ```
   droplet_count = 4
   ```

2. **Upgrade droplet size:**

   ```
   droplet_size = "s-4vcpu-8gb"
   ```

   Common sizes include:

   - s-1vcpu-1gb: 1 vCPU, 1GB RAM
   - s-2vcpu-2gb: 2 vCPU, 2GB RAM
   - s-4vcpu-8gb: 4 vCPU, 8GB RAM

### Regions

Available regions include:

- nyc1, nyc3: New York
- sfo3: San Francisco
- ams3: Amsterdam
- sgp1: Singapore
- lon1: London
- fra1: Frankfurt
- tor1: Toronto
- blr1: Bangalore

Example:

```
region = "fra1"
```

### Environment Configuration

Configure different environments by changing:

```
environment = "production"
```

Valid values are "development", "staging", and "production".

### Custom Server Setup

To modify the server configuration, edit the `scripts/setup.sh` file. You can add:

- Additional software packages
- Configuration files
- Security settings
- Application deployment steps

## Common Issues and Solutions

### SSH Key Issues

**Problem**: "SSH Key is already in use on your account"  
**Solution**: The configuration now uses existing SSH keys in your account automatically.

### VPC CIDR Conflicts

**Problem**: "This range/size overlaps with the range reserved for DigitalOcean internal use"  
**Solution**: Use the recommended CIDR range `10.118.0.0/20` or another non-conflicting range.

### API Token Issues

**Problem**: Failed to authenticate with Digital Ocean API  
**Solution**: Generate a new token with write permissions and update `terraform.tfvars`.

### Connection Issues

**Problem**: Cannot SSH into created droplets  
**Solutions**:

- Verify your SSH key path in `terraform.tfvars`
- Check the `allowed_ssh_ips` setting includes your current IP
- Wait a few minutes for the droplet to complete initialization

## Best Practices

### Security

1. **Restrict SSH access**:

   ```
   allowed_ssh_ips = ["your_public_ip/32"]
   ```

2. **Use unique projects** for different applications or environments

3. **Regular updates**:
   - Keep your Terraform version updated
   - Update the `droplet_image` to use the latest OS versions

### Cost Management

1. **Monitor resources** via the Digital Ocean dashboard

2. **Destroy unused resources**:

   ```bash
   ./deploy.sh destroy
   ```

3. **Right-size droplets** based on actual usage metrics

## Maintenance and Updates

### Updating Terraform Configuration

To update your Terraform configuration:

1. Back up your `terraform.tfvars` file
2. Update the configuration files
3. Run `./deploy.sh plan` to see the changes
4. Apply the changes with `./deploy.sh apply`

### Adding New Components

To add new Digital Ocean resources:

1. Edit the `main.tf` file to define new resources
2. Add any required variables to `variables.tf`
3. Update the documentation as needed

### Backup Strategy

1. **State backup**: The Terraform state contains all information about your infrastructure

   ```bash
   cp terraform.tfstate terraform.tfstate.backup
   ```

2. **Configuration backup**: Regularly back up your configuration files

---

This documentation is designed to help you automate your Digital Ocean infrastructure using Terraform. For more advanced use cases or questions, refer to the [Terraform documentation](https://www.terraform.io/docs) and [Digital Ocean API documentation](https://docs.digitalocean.com/reference/api/).
