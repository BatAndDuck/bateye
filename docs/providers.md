# Supported Providers

BatEye supports 20+ AI providers. All use the same `BATEYE_LLM_MODEL_API_KEY` environment variable — just change the `model` field in your config.

## Provider table

| Provider | Model format | Notes |
|---|---|---|
| Anthropic | `anthropic/claude-sonnet-4-5` | |
| OpenAI | `openai/gpt-4o` | |
| OpenRouter | `openrouter/meta-llama/llama-3.3-70b-instruct` | Access to 100+ models |
| Google | `google/gemini-2.0-flash` | |
| DeepSeek | `deepseek/deepseek-chat` | |
| Groq | `groq/llama-3.3-70b-versatile` | Fast inference |
| Cerebras | `cerebras/llama3.1-70b` | Fast inference |
| Together | `together/meta-llama/Llama-3-70b-chat-hf` | |
| Fireworks | `fireworks/accounts/fireworks/models/llama-v3p1-70b-instruct` | |
| xAI | `xai/grok-2` | |
| Mistral | `mistral/mistral-large-latest` | |
| Cohere | `cohere/command-r-plus` | |
| Perplexity | `perplexity/llama-3.1-sonar-large-128k-online` | |
| MiniMax | `minimax/minimax-m2.5` | |
| DeepInfra | `deepinfra/meta-llama/Meta-Llama-3.1-70B-Instruct` | |
| HuggingFace | `huggingface/...` | |
| Moonshot | `moonshot/moonshot-v1-8k` | |
| Novita | `novita/...` | |
| SambaNova | `sambanova/Meta-Llama-3.3-70B-Instruct` | |
| Nebius | `nebius/...` | |
| Azure | `azure/gpt-4o` | Requires `AZURE_RESOURCE_NAME` |
| Ollama (local) | `ollama/llama3.2` | No API key needed |
| LM Studio (local) | `lmstudio/...` | No API key needed |
| Vercel AI Gateway | `vercel/<provider>/<model>` | Uses `VERCEL_OIDC_TOKEN` |

## Picking a model

```bash
bateye models                  # List models for current provider
bateye models anthropic        # List Anthropic models
bateye models openai           # List OpenAI models
bateye config set model anthropic/claude-sonnet-4-5
```

## API key setup

All providers (except local and Vercel) use a single env var:

```bash
export BATEYE_LLM_MODEL_API_KEY=your-api-key
```

### Azure

Azure requires an additional env var:

```bash
export BATEYE_LLM_MODEL_API_KEY=your-azure-api-key
export AZURE_RESOURCE_NAME=your-resource-name
```

### Vercel AI Gateway

Uses OIDC instead of a static API key:

```bash
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token
```

Config:

```json
{
  "model": "vercel/minimax/minimax-m2.5"
}
```

### Ollama / LM Studio (local)

No API key needed. Start the local server, then:

```json
{
  "model": "ollama/llama3.2"
}
```

### Custom OpenAI-compatible gateway

Set `apiBaseUrl` in your config to point at any OpenAI-compatible endpoint:

```json
{
  "model": "openai/your-model",
  "apiBaseUrl": "https://your-gateway.example.com/v1"
}
```

## Recommendations

| Use case | Recommended model |
|---|---|
| Best quality | `anthropic/claude-sonnet-4-5` |
| Fast + cheap | `groq/llama-3.3-70b-versatile` |
| Long context | `google/gemini-2.0-flash` |
| No API key | `ollama/llama3.2` (local) |
| Cost-effective quality | `openrouter/meta-llama/llama-3.3-70b-instruct` |
