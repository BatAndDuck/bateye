# Supported Review Providers

BatEye's Codebite-backed agentic runtime powers `bateye audit`, `bateye pr-review`, and `bateye models`.

Those commands currently support exactly these providers:

- `openai`
- `anthropic`
- `google`
- `mistral`
- `vercel`

If you configure `openrouter`, `ollama`, `lmstudio`, `litellm`, `azure`, or a custom `apiBaseUrl`, BatEye now fails fast for agentic review instead of attempting a partially supported path.

## Quick setup

```bash
# Repo default used in this project
bateye conf --model vercel/openai/gpt-5.4-nano --apikey <your-key>

# OpenAI
bateye conf --model openai/gpt-5.4-nano --apikey <your-key>

# Anthropic
bateye conf --model anthropic/claude-sonnet-4-5 --apikey <your-key>

# Google
bateye conf --model google/gemini-2.5-pro --apikey <your-key>

# Mistral
bateye conf --model mistral/mistral-large-latest --apikey <your-key>
```

## Provider reference

| Provider | Model format | Credential | Notes |
|---|---|---|---|
| OpenAI | `openai/gpt-5.4-nano` | `BATEYE_LLM_MODEL_API_KEY` | Native OpenAI transport |
| Anthropic | `anthropic/claude-sonnet-4-5` | `BATEYE_LLM_MODEL_API_KEY` | Native Anthropic transport |
| Google | `google/gemini-2.5-pro` | `BATEYE_LLM_MODEL_API_KEY` | Native Google transport |
| Mistral | `mistral/mistral-large-latest` | `BATEYE_LLM_MODEL_API_KEY` | Native Mistral transport |
| Vercel AI Gateway | `vercel/openai/gpt-5.4-nano` | `BATEYE_LLM_MODEL_API_KEY`, `AI_GATEWAY_API_KEY`, or `VERCEL_OIDC_TOKEN` | Three-part `vercel/<provider>/<model>` format |

## OpenAI

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-...
bateye conf --model openai/gpt-5.4-nano
```

Popular options:

```bash
bateye conf --model openai/gpt-5.4-nano
bateye conf --model openai/gpt-5.4-mini
bateye conf --model openai/gpt-4o
```

## Anthropic

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-ant-...
bateye conf --model anthropic/claude-sonnet-4-5
```

Popular options:

```bash
bateye conf --model anthropic/claude-sonnet-4-5
bateye conf --model anthropic/claude-opus-4-5
bateye conf --model anthropic/claude-haiku-4-5-20251001
```

## Google

```bash
export BATEYE_LLM_MODEL_API_KEY=AIza...
bateye conf --model google/gemini-2.5-pro
```

Popular options:

```bash
bateye conf --model google/gemini-2.5-pro
bateye conf --model google/gemini-2.0-flash
bateye conf --model google/gemini-2.0-flash-lite
```

## Mistral

```bash
export BATEYE_LLM_MODEL_API_KEY=...
bateye conf --model mistral/mistral-large-latest
```

Popular options:

```bash
bateye conf --model mistral/mistral-large-latest
bateye conf --model mistral/mistral-small-latest
bateye conf --model mistral/codestral-latest
```

## Vercel AI Gateway

This repository defaults to Vercel-routed `openai/gpt-5.4-nano`.

```bash
export AI_GATEWAY_API_KEY=your-vercel-gateway-key
bateye conf --model vercel/openai/gpt-5.4-nano
```

You can also use OIDC:

```bash
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token
bateye conf --model vercel/openai/gpt-5.4-nano
```

More examples:

```bash
bateye conf --model vercel/anthropic/claude-sonnet-4-5
bateye conf --model vercel/google/gemini-2.5-pro
bateye conf --model vercel/mistral/mistral-large-latest
```

Structured BatEye calls also use the Vercel AI SDK gateway provider directly; they no longer fall back to a generic OpenAI-compatible adapter.

## Listing models

`bateye models` now lists only the providers supported by the Codebite-backed review runtime.

```bash
bateye models
bateye models openai
bateye models anthropic
bateye models google
bateye models mistral
bateye models vercel
bateye models --all
```

## Unsupported agentic setups

These are no longer valid for `bateye audit` and `bateye pr-review`:

- `openrouter/...`
- `ollama/...`
- `lmstudio/...`
- `litellm/...`
- `azure/...`
- any non-empty `apiBaseUrl`

If you need one of those routes, keep it out of your BatEye review config until BatEye adds a supported Codebite integration path for it.
