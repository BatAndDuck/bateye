---
id: secrets
name: Secrets Detection
description: Detects hardcoded API keys, passwords, tokens, and credentials in source code.
enabled: true
mode: both
category: security
scopeHints:
  - config
  - env
  - secret
  - auth
  - key
  - token
  - password
  - credential
  - api
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.yaml"
  - "**/*.yml"
  - "**/*.json"
  - "**/*.env*"
  - "**/*.sh"
---

Focus your review on:

## API Keys and Service Tokens
- Hardcoded API keys matching well-known prefixes committed directly in source: `sk-` (OpenAI/Stripe secret), `pk-` (Stripe public — acceptable in client code but worth noting), `ghp_` (GitHub personal access token), `ghs_` (GitHub Actions token), `xoxb-` / `xoxp-` (Slack tokens), `AKIA` (AWS access key ID prefix)
- Google API keys matching the pattern `AIza[0-9A-Za-z\-_]{35}`
- Twilio auth tokens, SendGrid keys, Mailgun keys, or other SaaS API credentials assigned directly to variables
- Database connection strings with embedded credentials (e.g., `mongodb://user:password@host`, `postgresql://user:pass@host/db`)
- JWT signing secrets hardcoded as string literals (e.g., `const JWT_SECRET = "supersecretvalue"`)

## Passwords and Credentials
- Hardcoded passwords in any form: variable names containing `password`, `passwd`, `pwd`, `secret`, `credential` assigned to string literals
- Default or test credentials left in production-path code (e.g., `username = "admin"`, `password = "admin123"`)
- Basic auth credentials embedded in HTTP URLs (`https://user:password@api.example.com`)
- SMTP passwords, FTP credentials, or SSH passphrases hardcoded in configuration or connection setup code
- Database credentials (username/password) specified inline rather than read from environment variables or a secrets manager

## Private Keys and Certificates
- PEM-formatted private key content (`-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----`) present anywhere in source
- Certificate private keys embedded in JavaScript/TypeScript objects or configuration files
- SSH private key content committed alongside application code
- PKCS#12 / PFX file paths hardcoded alongside the passphrase used to open them

## Configuration Files
- `.env` files committed to the repository with real secret values (`.env.example` with placeholder values is acceptable)
- `appsettings.json`, `application.yml`, `config.yaml`, `secrets.json`, or equivalent configuration files containing live credentials in the repository
- Terraform or other IaC files with inline secret values rather than references to a secrets store (Vault, AWS Secrets Manager, etc.)
- Docker Compose files with `environment:` blocks containing real passwords or tokens

## Tokens in Non-Obvious Locations
- API tokens or secrets embedded in code comments (e.g., `// TODO: replace token abc123xyz`)
- Tokens used in test fixtures or test helper files that appear to be real (non-obviously fake) credentials
- Secrets included in documentation code examples that could be mistaken for real values
- Authorization header values hardcoded in HTTP client setup (`headers: { Authorization: "Bearer abc123..." }`)
- Webhook secrets or signing keys hardcoded in event handler registration code

## Cloud Provider Credentials
- AWS secret access keys (40-character alphanumeric strings paired with an `AKIA`-prefixed key ID)
- GCP service account JSON key files committed to the repository or their contents inlined in code
- Azure storage account keys, connection strings, or SAS tokens hardcoded in source
- Kubernetes `Secret` manifest files with base64-encoded values committed to the repository without encryption (e.g., Sealed Secrets or SOPS)

## Confidence and Scope
- Only flag findings where there is high confidence the value is a real secret — not a placeholder like `YOUR_API_KEY_HERE`, `<YOUR_TOKEN>`, or `changeme`
- Do NOT flag environment variable reads (`process.env.API_KEY`, `os.environ["SECRET"]`) — these are the correct pattern
- Do NOT flag references to secrets managers (AWS SSM, HashiCorp Vault, GCP Secret Manager) — these are correct
- This reviewer does NOT cover OWASP injection vulnerabilities or authorization issues — only credential and secret exposure
