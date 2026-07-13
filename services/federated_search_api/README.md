# Federated Search API

Read-only backend API for federated proteomics search across:
- public PPA export bundle (remote JSON in GitHub repo)
- local PPA export bundle (fallback)
- PRIDE public API
- ProteomeXchange public API (adapter scaffold)
- optional MCP bridge endpoint (adapter scaffold)

The API is intentionally separate from the Astro site so browser clients never receive private keys.

For cloud deployment, the recommended configuration is to read export data from:

https://raw.githubusercontent.com/sparkydabear/PPA/main/export

via `PPA_EXPORT_BASE_URL`.

## Run

```bash
cd services/federated_search_api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

## API

- `GET /healthz`
- `GET /v1/search?q=<query>&limit=40`
- `POST /v1/chat`

`/healthz` includes source enablement diagnostics so you can confirm whether MCP is active at runtime.

Response shape:

```json
{
  "query": "tmt",
  "count": 12,
  "elapsed_ms": 87,
  "warnings": [],
  "results": [
    {
      "source": "ppa",
      "kind": "project",
      "score": 0.93,
      "title": "PXD000005",
      "subtitle": "DDA · Reporter ion MS2 · TMT",
      "snippet": "No instrument exported yet.",
      "link": "https://sparkydabear.github.io/PPA/projects/PXD000005/",
      "provenance": "public/PPA/export/pxd_index.json"
    }
  ]
}
```

## Keys and Secrets

Do not place API keys in the Astro frontend. Use only server environment variables.

## Smoke Test

Start the API in one terminal:

```bash
cd services/federated_search_api
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8787 --reload
```

In another terminal:

```bash
curl -s "http://127.0.0.1:8787/v1/search?q=PXD000005&limit=5" | python -m json.tool
curl -s -X POST "http://127.0.0.1:8787/v1/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"Find TMT studies in whole cell samples","history":[],"limit":8}' | python -m json.tool
```

The chat endpoint is MCP-only. If MCP chat is unavailable, the API returns a failure message and warnings.

## MCP Chat Agent Path

`POST /v1/chat` is designed for MCP-backed conversational retrieval.

1. If `MCP_CHAT_BRIDGE_URL` (or `MCP_BRIDGE_URL`) is configured, MCP source is auto-enabled by default.
2. You can explicitly override with `ENABLE_MCP_SOURCE=true|false`.
3. The response can include `citations` using the same schema as federated search results.

### Single-Service MCP Setup

If you do not run a separate MCP bridge service, this API now exposes an internal bridge endpoint at:

- `/v1/mcp/chat-bridge`

For a Render deployment at `https://ppa-gx72.onrender.com`, set:

- `MCP_CHAT_BRIDGE_URL=https://ppa-gx72.onrender.com/v1/mcp/chat-bridge`

Then enable MCP chat:

- `ENABLE_MCP_SOURCE=true`

Example request:

```json
{
  "message": "Find TMT studies in whole cell samples",
  "session_id": "optional-session-id",
  "limit": 12,
  "history": [
    {"role": "user", "content": "What are good starting queries?"},
    {"role": "assistant", "content": "Try PXD accessions, assay labels, or ontology terms."}
  ]
}
```
