---
id: ai-safety
name: AI Safety & Guardrails
description: Reviews AI/LLM integrations for prompt injection vulnerabilities, unsafe output handling, and missing reliability guardrails that protect users and the application.
enabled: true
mode: both
category: ai
selectWhen: "select when code integrates with LLM APIs (OpenAI, Anthropic, etc.), constructs prompts from dynamic input, processes LLM outputs, or implements AI-powered features; skip for codebases with no LLM or AI API usage"
---

Focus your review on:

## What counts as a REAL prompt injection risk
Prompt injection is only a risk when **untrusted external content** reaches an LLM system prompt or instruction context at runtime. Before reporting any injection finding, verify the source of the interpolated value:
- **REAL risk**: end-user input (CLI args, chat messages, form fields, HTTP request bodies), responses from external APIs, database values from third parties, file content uploaded by users
- **NOT a risk**: static template files or `.md` files bundled with the application, configuration files loaded from the local filesystem at startup, hard-coded strings in source code, values set by the application developers themselves

If the interpolated value comes from a static template, local config file, or bundled reviewer/instruction file - do NOT report it as injection risk. These are trusted internal values, not attack vectors.

## Prompt Injection Defense
- User-controlled content (CLI arguments, PR comments, file content from untrusted repos) concatenated directly into LLM system prompts without sanitization
- Missing instruction injection defenses where end-users can override system instructions
- Dynamic prompt construction where untrusted external content sets the behavior or persona of the LLM
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
