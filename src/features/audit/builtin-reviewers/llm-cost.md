---
id: llm-cost
name: LLM Cost Control
description: Identifies patterns that cause runaway LLM API token usage, suboptimal model selection, and missing cost controls that can lead to unexpectedly large API bills.
enabled: true
mode: both
category: ai
scopeHints:
  - llm
  - ai
  - openai
  - anthropic
  - gpt
  - claude
  - prompt
  - completion
  - token
  - model
  - chat
  - message
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Runaway Token Usage
- Unbounded loops that call LLM APIs (risk of infinite/very large API bills)
- Entire file or document contents sent as context when only a portion is relevant
- No maximum token limits set on completions (max_tokens parameter missing)
- Prompt templates that grow unboundedly with user input (no truncation)

## Model Selection
- Using the most expensive/largest model for tasks a smaller model could handle
- Streaming responses when the full response is needed (adds latency overhead without benefit)
- Multiple sequential LLM calls that could be combined into one
- LLM calls for tasks that could be handled with deterministic code (regex, simple parsing)

## Cost Controls
- No rate limiting or per-user quota on LLM-powered endpoints
- Missing cost estimation or logging of token usage per request
- No caching of identical or semantically equivalent prompts
- Embeddings recomputed on every request for static content that rarely changes
