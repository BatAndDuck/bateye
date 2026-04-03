# Supported Providers

BatEye supports 20+ AI providers. All use the same `BATEYE_LLM_MODEL_API_KEY` environment variable - just change the `model` field in your config.

## Quick examples

```bash
# Anthropic
export BATEYE_LLM_MODEL_API_KEY=sk-ant-...
bateye conf --model anthropic/claude-sonnet-4-5

# OpenAI
export BATEYE_LLM_MODEL_API_KEY=sk-...
bateye conf --model openai/gpt-4o

# Groq (fast + free tier)
export BATEYE_LLM_MODEL_API_KEY=gsk_...
bateye conf --model groq/llama-3.3-70b-versatile

# Ollama — no API key needed, runs locally
bateye conf --model ollama/llama3.2

# OpenRouter — one key, access to 200+ models
export BATEYE_LLM_MODEL_API_KEY=sk-or-...
bateye conf --model openrouter/anthropic/claude-sonnet-4-5
```

## Provider reference

| Provider | Model format | API key env | Notes |
|---|---|---|---|
| Anthropic | `anthropic/claude-sonnet-4-5` | `BATEYE_LLM_MODEL_API_KEY` | |
| OpenAI | `openai/gpt-4o` | `BATEYE_LLM_MODEL_API_KEY` | |
| OpenRouter | `openrouter/meta-llama/llama-3.3-70b-instruct` | `BATEYE_LLM_MODEL_API_KEY` | 200+ models via one key |
| Google | `google/gemini-2.0-flash` | `BATEYE_LLM_MODEL_API_KEY` | |
| DeepSeek | `deepseek/deepseek-chat` | `BATEYE_LLM_MODEL_API_KEY` | |
| Groq | `groq/llama-3.3-70b-versatile` | `BATEYE_LLM_MODEL_API_KEY` | Fast inference |
| Cerebras | `cerebras/llama3.1-70b` | `BATEYE_LLM_MODEL_API_KEY` | Fast inference |
| xAI | `xai/grok-3` | `BATEYE_LLM_MODEL_API_KEY` | |
| Mistral | `mistral/mistral-large-latest` | `BATEYE_LLM_MODEL_API_KEY` | |
| Cohere | `cohere/command-r-plus` | `BATEYE_LLM_MODEL_API_KEY` | |
| Perplexity | `perplexity/llama-3.1-sonar-large-128k-online` | `BATEYE_LLM_MODEL_API_KEY` | |
| Together | `together/meta-llama/Llama-3-70b-chat-hf` | `BATEYE_LLM_MODEL_API_KEY` | |
| Fireworks | `fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct` | `BATEYE_LLM_MODEL_API_KEY` | |
| MiniMax | `minimax/minimax-m2.5` | `BATEYE_LLM_MODEL_API_KEY` | |
| DeepInfra | `deepinfra/meta-llama/Meta-Llama-3.1-70B-Instruct` | `BATEYE_LLM_MODEL_API_KEY` | |
| HuggingFace | `huggingface/meta-llama/Meta-Llama-3.1-8B-Instruct` | `BATEYE_LLM_MODEL_API_KEY` | |
| Moonshot | `moonshot/moonshot-v1-8k` | `BATEYE_LLM_MODEL_API_KEY` | |
| Novita | `novita/meta-llama/llama-3.1-70b-instruct` | `BATEYE_LLM_MODEL_API_KEY` | |
| SambaNova | `sambanova/Meta-Llama-3.3-70B-Instruct` | `BATEYE_LLM_MODEL_API_KEY` | |
| Nebius | `nebius/meta-llama/Meta-Llama-3.1-70B-Instruct` | `BATEYE_LLM_MODEL_API_KEY` | |
| Azure | `azure/gpt-4o` | `BATEYE_LLM_MODEL_API_KEY` | Also needs `AZURE_RESOURCE_NAME` |
| Ollama (local) | `ollama/llama3.2` | none | Free, runs locally |
| LM Studio (local) | `lmstudio/local-model` | none | Free, runs locally |
| LiteLLM proxy | `litellm/<model>` | `BATEYE_LLM_MODEL_API_KEY` | Any model your proxy serves |
| Vercel AI Gateway | `vercel/anthropic/claude-sonnet-4-5` | `VERCEL_OIDC_TOKEN` | |

---

## Anthropic

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-ant-api03-...
bateye conf --model anthropic/claude-sonnet-4-5
```

Popular models:

```bash
bateye conf --model anthropic/claude-sonnet-4-5   # balanced — recommended default
bateye conf --model anthropic/claude-opus-4-5     # highest quality
bateye conf --model anthropic/claude-haiku-4-5    # fastest, cheapest
```

---

## OpenAI

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-proj-...
bateye conf --model openai/gpt-4o
```

Popular models:

```bash
bateye conf --model openai/gpt-4o           # best quality
bateye conf --model openai/gpt-4o-mini      # cheaper, still strong
bateye conf --model openai/o3-mini          # reasoning model
```

---

## OpenRouter

One API key, access to 200+ models from Anthropic, Meta, Mistral, Google, and more.

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-or-v1-...
bateye conf --model openrouter/anthropic/claude-sonnet-4-5
```

More examples:

```bash
bateye conf --model openrouter/meta-llama/llama-3.3-70b-instruct
bateye conf --model openrouter/google/gemini-2.0-flash-001
bateye conf --model openrouter/mistralai/mistral-large
bateye conf --model openrouter/deepseek/deepseek-chat
```

---

## Google

```bash
export BATEYE_LLM_MODEL_API_KEY=AIza...
bateye conf --model google/gemini-2.0-flash
```

Popular models:

```bash
bateye conf --model google/gemini-2.0-flash        # fast, long context
bateye conf --model google/gemini-2.5-pro          # highest quality
bateye conf --model google/gemini-2.0-flash-lite   # cheapest
```

---

## Groq

Very fast inference (often 500+ tokens/sec). Free tier available.

```bash
export BATEYE_LLM_MODEL_API_KEY=gsk_...
bateye conf --model groq/llama-3.3-70b-versatile
```

Popular models:

```bash
bateye conf --model groq/llama-3.3-70b-versatile    # best quality on Groq
bateye conf --model groq/llama-3.1-8b-instant       # fastest
bateye conf --model groq/mixtral-8x7b-32768         # long context
```

---

## DeepSeek

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-...
bateye conf --model deepseek/deepseek-chat
```

Popular models:

```bash
bateye conf --model deepseek/deepseek-chat      # general purpose
bateye conf --model deepseek/deepseek-reasoner  # reasoning (slower)
```

---

## xAI (Grok)

```bash
export BATEYE_LLM_MODEL_API_KEY=xai-...
bateye conf --model xai/grok-3
```

---

## Mistral

```bash
export BATEYE_LLM_MODEL_API_KEY=...
bateye conf --model mistral/mistral-large-latest
```

Popular models:

```bash
bateye conf --model mistral/mistral-large-latest   # best quality
bateye conf --model mistral/mistral-small-latest   # cheaper
bateye conf --model mistral/codestral-latest       # code-focused
```

---

## Cerebras

Fast inference hardware. Good for quick scans.

```bash
export BATEYE_LLM_MODEL_API_KEY=csk-...
bateye conf --model cerebras/llama3.1-70b
```

---

## Perplexity

```bash
export BATEYE_LLM_MODEL_API_KEY=pplx-...
bateye conf --model perplexity/llama-3.1-sonar-large-128k-online
```

---

## Together AI

```bash
export BATEYE_LLM_MODEL_API_KEY=...
bateye conf --model together/meta-llama/Llama-3-70b-chat-hf
```

---

## Fireworks AI

```bash
export BATEYE_LLM_MODEL_API_KEY=fw_...
bateye conf --model fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct
```

---

## Azure OpenAI

```bash
export BATEYE_LLM_MODEL_API_KEY=your-azure-api-key
export AZURE_RESOURCE_NAME=your-resource-name
bateye conf --model azure/gpt-4o
```

The model name is your Azure deployment name, not the OpenAI model name.

---

## Ollama (local, free)

No API key needed. [Install Ollama](https://ollama.com), pull a model, then:

```bash
ollama pull llama3.2
bateye conf --model ollama/llama3.2
```

More examples:

```bash
bateye conf --model ollama/llama3.2             # 3B, fast
bateye conf --model ollama/llama3.1:8b          # 8B, better quality
bateye conf --model ollama/qwen2.5-coder:7b     # code-focused
bateye conf --model ollama/mistral              # Mistral 7B
bateye conf --model ollama/deepseek-r1:8b       # reasoning
```

BatEye connects to Ollama at `http://localhost:11434` automatically.

---

## LM Studio (local, free)

No API key needed. Start the local server in LM Studio (port 1234), then:

```bash
bateye conf --model lmstudio/local-model
```

Replace `local-model` with whatever model identifier LM Studio is serving. BatEye connects to `http://localhost:1234` automatically.

---

## LiteLLM proxy

[LiteLLM](https://github.com/BerriAI/litellm) runs a local OpenAI-compatible proxy that can route to 100+ providers behind the scenes. Useful for teams sharing a single gateway or routing across providers without changing BatEye config.

**Default setup** (LiteLLM on localhost:4000):

```bash
export BATEYE_LLM_MODEL_API_KEY=sk-your-litellm-master-key
bateye conf --model litellm/gpt-4o
```

The model name after `litellm/` must match exactly what your LiteLLM proxy has configured — not the upstream provider's name.

**Examples** (model names depend on your LiteLLM config):

```bash
bateye conf --model litellm/gpt-4o
bateye conf --model litellm/claude-sonnet
bateye conf --model litellm/llama-3.3-70b
bateye conf --model litellm/my-custom-deployment
```

**Remote or non-default port** — set `apiBaseUrl` to override the default `localhost:4000`:

```bash
bateye config set apiBaseUrl http://your-host:4000/v1
bateye conf --model openai/gpt-4o --apikey sk-your-litellm-key
```

When `apiBaseUrl` is set, any provider prefix works — BatEye routes all traffic through that URL.

**Common mistake** — do not nest the upstream provider name in the model string:

```bash
# Wrong — this tries to reach api.openai.com with model "litellm/..."
bateye conf --model openai/litellm/gpt-4o

# Correct
bateye conf --model litellm/gpt-4o
```

---

## Vercel AI Gateway

Uses OIDC instead of a static API key. Set up in your Vercel project, then:

```bash
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token
bateye conf --model vercel/anthropic/claude-sonnet-4-5
```

More examples:

```bash
bateye conf --model vercel/openai/gpt-4o
bateye conf --model vercel/google/gemini-2.0-flash
bateye conf --model vercel/deepseek/deepseek-chat
bateye conf --model vercel/meta/llama-3.3-70b
```

Run `bateye models vercel` to see all models available through your gateway.

---

## Custom OpenAI-compatible gateway

Any OpenAI-compatible endpoint works via `apiBaseUrl`:

```bash
bateye config set apiBaseUrl https://your-gateway.example.com/v1
bateye conf --model openai/your-model-name --apikey your-key
```

Both structured calls and agentic reviews are routed through the custom URL.

---

## Picking a model

```bash
bateye models                  # list models for current provider
bateye models anthropic        # list Anthropic models
bateye models openai           # list OpenAI models
bateye models groq             # list Groq models
```

## Recommendations

| Goal | Model |
|---|---|
| Best quality | `anthropic/claude-sonnet-4-5` |
| Best quality (free) | `ollama/llama3.1:8b` |
| Fast + cheap | `groq/llama-3.3-70b-versatile` |
| Long context | `google/gemini-2.0-flash` |
| No API key | `ollama/llama3.2` |
| One key, many models | `openrouter/meta-llama/llama-3.3-70b-instruct` |
| Team proxy | `litellm/your-model` |
