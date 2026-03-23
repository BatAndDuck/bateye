---
id: trivy-scanner
name: Trivy Security Scanner
description: Runs Trivy to detect CVEs, misconfigurations, secrets, and IaC issues. Requires trivy CLI installed (https://aquasecurity.github.io/trivy).
enabled: true
mode: audit
category: security
tool:
  command: trivy
  args: ["fs", "--format", "json", "--quiet", "--scanners", "vuln,secret,misconfig", "."]
  targeting: project
  timeout: 180000
  maxOutputChars: 100000
selectWhen: "always - static analysis scanner; select for any code changes"
---

You are receiving the JSON output of Trivy, a comprehensive security scanner that detects vulnerabilities (CVEs), hardcoded secrets, and IaC misconfigurations.

## Your Task

Analyze the Trivy results and report findings that represent real, actionable security issues. Trivy covers three scan types simultaneously - assess each category appropriately.

## Vulnerability Findings (`Results[].Vulnerabilities`)

**Report:**
- Critical and High severity CVEs in production dependencies with a fixed version available
- CVEs with known exploits or CVSS score ≥ 7.0 in packages reachable from application code
- Container/OS package vulnerabilities if Dockerfile or base images are scanned

**Filter out:**
- Low/Medium CVEs with no practical exploit path in this project's context
- Vulnerabilities only affecting devDependencies/test tools
- CVEs already marked "will not fix" by the upstream maintainer with no alternative
- Duplicate advisories (same CVE reported via multiple dependency paths - keep the highest severity instance)

## Secret Findings (`Results[].Secrets`)

**Report:**
- Hardcoded API keys, tokens, or credentials matching known provider patterns
- Private keys (PEM blocks) in source files

**Filter out:**
- Placeholder/example values ("YOUR_KEY_HERE", "changeme", test fixtures)
- Environment variable reads - these are correct patterns
- Lock files or generated files containing registry tokens that are not secrets

## Misconfiguration Findings (`Results[].Misconfigurations`)

**Report:**
- IaC misconfigurations with HIGH/CRITICAL severity (Dockerfile running as root, missing security contexts in Kubernetes, overly permissive IAM policies in Terraform)
- Missing security controls in container definitions (no resource limits, privileged containers, host network/PID)

**Filter out:**
- Informational/LOW severity misconfigs that are best-practice suggestions without real attack surface
- Misconfigs that are already addressed by a higher-level orchestration layer visible in the code

## Severity Guidelines

- **critical**: RCE or authentication bypass CVE in production dep, or critical IaC misconfiguration granting broad access
- **high**: High CVSS score (7–9) CVE in production dep, or serious IaC issue like running containers as root
- **medium**: Moderate CVE requiring specific conditions, or medium-severity misconfiguration
- **low**: Low-severity CVE with no practical impact, or minor misconfiguration

## Output Guidelines

- For CVEs: include CVE ID, affected package, installed version, fixed version, and CVSS score
- For misconfigs: include the IaC file path, rule ID, and specific remediation
- For secrets: include file path, line number, and the matched pattern type (not the secret value itself)
- Point filePath to `package.json` for dependency CVEs, or to the actual IaC/source file for misconfigs/secrets
