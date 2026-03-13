---
id: container
name: Container Security & Efficiency
description: Reviews Dockerfile and Kubernetes configurations for security misconfigurations, overly permissive settings, and missing resource controls.
enabled: true
mode: both
category: infrastructure
scopeHints:
  - docker
  - dockerfile
  - container
  - image
  - kubernetes
  - k8s
  - helm
  - compose
recommendedGlobs:
  - "**/Dockerfile*"
  - "**/*.dockerfile"
  - "**/docker-compose*.yml"
  - "**/*.yaml"
  - "**/k8s/**"
---

Focus your review on:

## Dockerfile Security
- Running processes as root — missing `USER` instruction or explicitly setting `USER root`, giving a compromised process full container filesystem access
- Using `latest` tag or no tag for base images instead of a pinned digest or specific version, causing non-deterministic builds that silently pull different image content over time
- Bloated base images (`node:latest`, `python:latest`) where a minimal alternative (`node:alpine`, `python:slim`, or distroless) would dramatically reduce attack surface and image size
- Secrets, API keys, or credentials passed as `ARG` or `ENV` build-time arguments — these are visible in image layers and in `docker history` output
- Missing `.dockerignore` file causing sensitive files or large directories to be copied into the image: `node_modules`, `.git`, `.env`, `*.key`, local build artifacts
- Installing development tools, debuggers, or test frameworks in the production image that are not needed at runtime, increasing attack surface
- `RUN` commands that install packages but don't clean up the package manager cache in the same layer (`apt-get clean`, `rm -rf /var/lib/apt/lists/*`), inflating image size
- `COPY . .` before installing dependencies, breaking layer caching and causing full dependency reinstall on every code change — dependencies should be installed in a separate earlier layer
- Multi-stage build not used when the build toolchain is not needed at runtime — shipping compiler, build tools, and intermediate artifacts in the final image

## Kubernetes Security
- Containers running as root in pod spec — missing `securityContext.runAsNonRoot: true` and `securityContext.runAsUser` with a non-zero UID
- Privileged containers (`securityContext.privileged: true`) that have near-host-level access and can escape container isolation
- Missing read-only root filesystem (`securityContext.readOnlyRootFilesystem: true`) — writable filesystems allow attackers to modify binaries or write malicious scripts
- Containers with `hostNetwork: true` or `hostPID: true` that share the host's network or process namespace, enabling container escape paths
- Missing network policies — by default, all pods can communicate with all other pods; network policies should restrict traffic to the minimum required paths
- Secrets stored as plaintext values in `ConfigMap` objects instead of `Secret` objects or external secrets operators (Vault, AWS Secrets Manager CSI driver)
- `allowPrivilegeEscalation: true` (the default) not explicitly set to `false`, allowing processes inside the container to gain more privileges than their parent process
- Missing pod security admission (PSA) or pod security policies enforcing baseline or restricted security standards across the namespace

## Resource Management
- Missing CPU and memory `requests` on containers — without requests, the scheduler cannot make informed placement decisions, leading to node overcommit and OOM kills
- Missing CPU and memory `limits` on containers — without limits, a runaway process can consume all resources on a node and evict other workloads
- Containers without `livenessProbe` — Kubernetes cannot detect a deadlocked or frozen process and restart it automatically
- Containers without `readinessProbe` — traffic is sent to pods that are still initializing or temporarily unable to serve, causing request failures during rolling deployments
- Missing `podDisruptionBudget` for stateful or critical workloads — node drains or cluster upgrades can take all instances offline simultaneously without a PDB
- `imagePullPolicy: Always` in production workloads — causes a registry pull on every pod restart, adding latency and registry dependency to pod startup
- Missing horizontal pod autoscaler (HPA) or KEDA configuration for workloads with variable traffic, causing either under-provisioning at peak or over-provisioning at idle
