---
id: network-policy
name: Network Policy
description: Checks for insecure CORS configurations, exposed sensitive headers, and network security misconfigurations.
enabled: true
mode: both
category: security
selectWhen: "select when code configures CORS, HTTP security headers, TLS, rate limiting, or network middleware; also when API gateway, proxy, or reverse proxy configuration is present; skip for codebases with no HTTP server or network configuration"
---

Focus your review on:

## CORS Configuration
- `Access-Control-Allow-Origin: *` (wildcard) set on API endpoints that require authentication or carry sensitive data — a wildcard origin allows any website to make cross-origin requests
- `Access-Control-Allow-Credentials: true` combined with a wildcard or dynamically reflected `Access-Control-Allow-Origin` — this combination allows cross-origin requests to include cookies/auth headers from any origin
- CORS origin allowlist validated using a weak string match (e.g., `origin.includes("trusted.com")`) that can be bypassed with a crafted domain like `evil-trusted.com`
- `Access-Control-Allow-Methods: *` or an overly broad methods list exposing methods (DELETE, PUT) that should not be callable cross-origin for a given endpoint
- Pre-flight request (`OPTIONS`) handling that short-circuits authorization middleware, allowing unauthenticated pre-flight requests to probe the API

## Response Header Exposure
- `Server` header revealing the web server name and version (e.g., `Server: nginx/1.14.0`) — provides version fingerprinting to attackers
- `X-Powered-By` header exposing the framework or runtime version (e.g., `X-Powered-By: Express`, `X-Powered-By: PHP/7.4`)
- Internal stack traces, file paths, or error details returned in HTTP response bodies or headers in production environments
- `X-AspNet-Version`, `X-AspNetMvc-Version`, or similar framework-identifying headers not suppressed
- Internal service hostnames, IP addresses, or infrastructure details included in error responses or redirect locations

## Security Headers Missing
- Missing `Strict-Transport-Security` (HSTS) header on HTTPS responses — without it, browsers may accept HTTP downgrade attacks
- Missing `Content-Security-Policy` header — allows inline scripts and arbitrary script sources, increasing XSS risk
- Missing `X-Content-Type-Options: nosniff` — browsers may MIME-sniff responses, enabling content injection attacks
- Missing `X-Frame-Options: DENY` or `SAMEORIGIN` (or equivalent `Content-Security-Policy: frame-ancestors`) — allows clickjacking
- Missing `Referrer-Policy` header — full URL (including sensitive query parameters) may be leaked to third-party domains in the `Referer` header
- Missing `Permissions-Policy` (formerly `Feature-Policy`) on sensitive applications that should restrict access to camera, microphone, or geolocation

## TLS and Transport
- HTTP URLs used where HTTPS is required for transmitting authentication tokens, session cookies, or sensitive data
- Explicit TLS version configuration allowing TLS 1.0 or TLS 1.1 — these are deprecated and have known vulnerabilities
- Weak cipher suites configured (RC4, DES, 3DES, export-grade ciphers) in TLS server configuration
- `rejectUnauthorized: false` in Node.js TLS options or equivalent certificate verification disabled in HTTP clients — disables server certificate validation entirely
- Self-signed certificate accepted in production code paths without a legitimate exception

## Rate Limiting and Denial of Service
- Public or unauthenticated endpoints with no rate limiting, allowing unbounded request floods
- Authentication endpoints (login, password reset, OTP) without brute-force protection (rate limiting, account lockout, CAPTCHA)
- Missing `Content-Length` or request body size limits on upload or JSON parsing middleware — allows large payloads to exhaust memory
- Missing response headers (`Retry-After`, `X-RateLimit-Remaining`) on rate-limited endpoints, making it harder for clients to back off gracefully

## Infrastructure and Proxy Configuration
- Overly permissive firewall or security group rules in IaC (Terraform, CloudFormation) that open ports to `0.0.0.0/0` unnecessarily
- Internal service ports (databases, admin UIs, monitoring dashboards) exposed to public network interfaces
- Reverse proxy configurations that forward all headers from the client to the upstream, allowing header injection
- `X-Forwarded-For` or `X-Real-IP` headers trusted for IP-based access control without ensuring they are only set by a trusted proxy
- Internal service URLs or private IP addresses returned in API responses or redirect headers that leak network topology
