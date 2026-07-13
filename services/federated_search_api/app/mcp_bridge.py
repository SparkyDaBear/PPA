from __future__ import annotations

from .clients import chat_openai_fallback_grounded, search_ppa_local
from .schemas import ChatRequest, SearchResult


async def run_internal_mcp_chat_bridge(payload: ChatRequest) -> dict:
    citations_result = await search_ppa_local(payload.message, limit=payload.limit)
    citations: list[SearchResult] = citations_result.results
    warnings = list(citations_result.warnings)

    completion = await chat_openai_fallback_grounded(
        query=payload.message,
        citations=citations,
        history=payload.history,
    )

    reply = (completion.get('reply') or '').strip()
    warnings.extend(completion.get('warnings', []))

    if not reply:
        warnings.append('internal MCP bridge model call returned no reply')

    return {
        'reply': reply,
        'session_id': payload.session_id,
        'model': completion.get('model'),
        'citations': [citation.model_dump() for citation in citations],
        'warnings': warnings,
    }
