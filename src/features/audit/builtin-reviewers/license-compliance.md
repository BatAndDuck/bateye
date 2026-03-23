---
id: license-compliance
name: License Compliance
description: Audits project dependencies for viral licenses (GPL, AGPL) that may conflict with commercial use, license incompatibilities, and due diligence gaps in license review.
enabled: true
mode: audit
category: dependency
selectWhen: "select when new dependencies are added or as a periodic audit of dependency licenses; especially important for commercial or proprietary projects; skip for changes with no dependency additions"
---

Focus your review on:

## Viral Licenses
- GPL or LGPL licensed dependencies in commercial or proprietary projects (copyleft contamination risk)
- AGPL dependencies in SaaS applications (AGPL requires source disclosure for network use)
- Dependencies with licenses that require attribution not documented in NOTICE file

## License Incompatibility
- Mixing GPL and Apache 2.0 licensed code (incompatible in some configurations)
- No license file in the repository itself
- Dependencies with unclear or custom licenses that haven't been reviewed

## Due Diligence
- New dependencies added without checking their license
- Transitive dependencies with problematic licenses (not just direct dependencies)
- Missing license information in package.json / pyproject.toml
