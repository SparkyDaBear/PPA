from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .chat import run_chat
from .mcp_bridge import run_internal_mcp_chat_bridge
from .schemas import ChatRequest, ChatResponse, SearchResponse
from .search import run_federated_search
from .settings import settings

app = FastAPI(title='PPA Federated Search API', version='0.1.0')

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=['GET', 'POST', 'OPTIONS'],
    allow_headers=['*'],
)


@app.get('/healthz')
def healthz() -> dict:
    return {
        'ok': True,
        'service': 'federated-search-api',
        'origins': settings.cors_origins,
        'sources': {
            'pride': settings.enable_pride,
            'proteomexchange': settings.enable_proteomexchange,
            'mcp': settings.enable_mcp_source,
        },
        'mcp': {
            'bridge_url_configured': bool(settings.mcp_bridge_url),
            'chat_bridge_url_configured': bool(settings.mcp_chat_bridge_url),
        },
    }


@app.get('/v1/search', response_model=SearchResponse)
async def search(
    q: str = Query(min_length=2, max_length=200),
    limit: int = Query(default=40, ge=1, le=100),
) -> SearchResponse:
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail='Query cannot be empty')
    return await run_federated_search(query=query, limit=limit)


@app.post('/v1/chat', response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    return await run_chat(payload)


@app.post('/v1/mcp/chat-bridge')
async def internal_mcp_chat_bridge(payload: ChatRequest) -> dict:
    return await run_internal_mcp_chat_bridge(payload)
