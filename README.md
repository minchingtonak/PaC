# Pangolin-as-code (PaC)

Deploys [Pangolin](https://github.com/fosrl/pangolin) to a Hetzner cloud VPS using Pulumi IaC.

Includes automated DNS configuration via Porkbun.

## Prerequisites

- Pulumi CLI
- Hetzner Cloud account
- Porkbun domain and API credentials

## Usage

```bash
pulumi stack init <stack-name> # see Pulumi.dev.yaml for an example of a stack named 'dev'
pulumi up # this will error until all config variables are set. follow the instructions to set config values
```

## What gets deployed

- Hetzner VPS with Docker
- Pangolin dashboard with Traefik reverse proxy
- Automated DNS records via Porkbun
- SSL certificates via Let's Encrypt
