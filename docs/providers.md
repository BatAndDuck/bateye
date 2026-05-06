# Supported Review Providers

BatEye's structured runtime and Codebite-backed agentic runtime power `bateye audit`, `bateye pr-review`, and `bateye models`.

Those commands currently support these providers:

- `openai`
- `anthropic`
- `google`
- `mistral`
- `vercel`
- `groq`
- `xai`
- `cohere`
- `deepseek`
- `bedrock`
- `azure`
- `togetherai`
- `fireworks`
- `litellm`

For local-only or custom endpoints such as Ollama and LM Studio, route them through LiteLLM and configure BatEye with the `litellm/...` model prefix.

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

# LiteLLM proxy, defaulting to http://localhost:4000
bateye conf --model litellm/ollama/llama3 --apikey none
```

Use `apiBaseUrl` when your LiteLLM proxy is not running on `http://localhost:4000`:

```bash
bateye config set apiBaseUrl http://localhost:8000
```

## Provider Reference

| Provider | Model format | Credential | Notes |
|---|---|---|---|
| OpenAI | `openai/gpt-5.4-nano` | `BATEYE_LLM_MODEL_API_KEY` | Native OpenAI transport |
| Anthropic | `anthropic/claude-sonnet-4-5` | `BATEYE_LLM_MODEL_API_KEY` | Native Anthropic transport |
| Google | `google/gemini-2.5-pro` | `BATEYE_LLM_MODEL_API_KEY` | Native Google transport |
| Mistral | `mistral/mistral-large-latest` | `BATEYE_LLM_MODEL_API_KEY` | Native Mistral transport |
| Vercel AI Gateway | `vercel/openai/gpt-5.4-nano` | `BATEYE_LLM_MODEL_API_KEY`, `AI_GATEWAY_API_KEY`, or `VERCEL_OIDC_TOKEN` | Three-part `vercel/<provider>/<model>` format |
| Groq | `groq/llama-3.3-70b-versatile` | `BATEYE_LLM_MODEL_API_KEY` | OpenAI-compatible hosted models |
| xAI | `xai/grok-3` | `BATEYE_LLM_MODEL_API_KEY` | Grok models |
| Cohere | `cohere/command-r-plus` | `BATEYE_LLM_MODEL_API_KEY` | Command models |
| DeepSeek | `deepseek/deepseek-chat` | `BATEYE_LLM_MODEL_API_KEY` | Chat and reasoning models |
| AWS Bedrock | `bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0` | AWS environment or configured key placeholder | Uses the Bedrock AI SDK provider |
| Azure OpenAI | `azure/<deployment-name>` | `BATEYE_LLM_MODEL_API_KEY` | Requires `apiBaseUrl` |
| Together AI | `togetherai/meta-llama/Llama-3.3-70B-Instruct-Turbo` | `BATEYE_LLM_MODEL_API_KEY` | Hosted open models |
| Fireworks AI | `fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct` | `BATEYE_LLM_MODEL_API_KEY` | Hosted open models |
| LiteLLM | `litellm/ollama/llama3` | `BATEYE_LLM_MODEL_API_KEY` or `none` for unauthenticated local proxy | OpenAI-compatible proxy; defaults to `http://localhost:4000` |

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

Structured BatEye calls use the Vercel AI SDK gateway provider directly.

## LiteLLM

LiteLLM exposes an OpenAI-compatible proxy. BatEye uses it through the OpenAI-compatible transport, so the model string is passed to your proxy exactly as configured.

```bash
# Start LiteLLM locally, for example:
litellm --model ollama/llama3

# BatEye defaults litellm to http://localhost:4000
bateye conf --model litellm/ollama/llama3 --apikey none
```

For a remote or non-default proxy:

```bash
bateye config set apiBaseUrl https://litellm.example.com
bateye conf --model litellm/openai/gpt-4o --apikey <proxy-key>
```

The `litellm/...` prefix selects BatEye's LiteLLM transport. The remaining model ID, such as `ollama/llama3` or `openai/gpt-4o`, is sent to LiteLLM.

## Azure OpenAI

Azure OpenAI requires an endpoint configured as `apiBaseUrl`.

```bash
bateye config set apiBaseUrl https://<resource>.openai.azure.com/openai/deployments
bateye conf --model azure/<deployment-name> --apikey <azure-api-key>
```

## Listing Models

```bash
bateye models
bateye models openai
bateye models anthropic
bateye models google
bateye models mistral
bateye models vercel
bateye models litellm
bateye models --all
```

For OpenAI-compatible providers, including LiteLLM, `bateye models <provider>` queries the provider's `/models` endpoint. If the proxy does not expose that endpoint, the command may return no model list even though configured model calls can still work.

## Unsupported Native Prefixes

These are not native BatEye provider prefixes:

- `openrouter/...`
- `ollama/...`
- `lmstudio/...`

Use `litellm/...` or `vercel/...` to route those model IDs through a supported gateway.
