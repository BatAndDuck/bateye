---
id: ai-safety
name: AI Safety & Guardrails
description: Reviews AI/LLM integrations for prompt injection vulnerabilities, unsafe output handling, and missing reliability guardrails that protect users and the application.
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
  - output
  - moderation
  - safety
  - guardrail
  - content
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Prompt Injection Defense
- User input concatenated directly into system prompts without sanitization
- Missing instruction injection defenses (user can override system instructions)
- Dynamic prompt construction that allows user-controlled system-level instructions
- Missing validation that LLM output matches expected schema before use

## Output Safety
- LLM outputs rendered directly to HTML without sanitization (XSS via AI-generated content)
- Missing content moderation/filtering before displaying AI responses to users
- AI-generated code executed without sandboxing or review
- Sensitive data included in prompts that get logged or stored

## Reliability
- No retry logic for LLM API rate limits or transient failures
- No fallback behavior when LLM API is unavailable
- Missing timeout on LLM calls (can block indefinitely)
- LLM responses used in critical decision paths without human oversight or confidence thresholds
