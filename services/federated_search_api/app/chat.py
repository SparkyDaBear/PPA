from __future__ import annotations

import uuid
import re

from .clients import chat_mcp_bridge, search_ppa_local
from .schemas import ChatRequest, ChatResponse, SearchResult


def _to_citations(raw: list[dict]) -> list[SearchResult]:
    citations: list[SearchResult] = []
    for row in raw:
        try:
            citations.append(SearchResult(**row))
        except Exception:
            continue
    return citations


def _query_tokens(query: str) -> list[str]:
    # Keep semantically useful tokens to detect whether evidence actually matches constraints.
    tokens = re.findall(r'[a-zA-Z0-9_-]+', query.lower())
    return [token for token in tokens if len(token) >= 4]


def _citation_text(citation: SearchResult) -> str:
    return ' '.join(
        [
            citation.title or '',
            citation.subtitle or '',
            citation.snippet or '',
            citation.provenance or '',
        ]
    ).lower()


def _evidence_is_constraint_match(query: str, citations: list[SearchResult]) -> bool:
    tokens = _query_tokens(query)
    if not tokens or not citations:
        return False

    merged = ' '.join(_citation_text(citation) for citation in citations)
    # Treat at least two token hits as minimally grounded for multi-constraint questions.
    hit_count = sum(1 for token in tokens if token in merged)
    return hit_count >= min(2, len(tokens))


async def run_chat(request: ChatRequest) -> ChatResponse:
    active_session_id = request.session_id or f'session-{uuid.uuid4().hex[:12]}'

    mcp = await chat_mcp_bridge(
        message=request.message,
        history=request.history,
        session_id=active_session_id,
        limit=request.limit,
    )

    warnings = list(mcp.get('warnings', []))
    reply = (mcp.get('reply') or '').strip()
    model = mcp.get('model')
    session_id = mcp.get('session_id') or active_session_id
    citations = _to_citations(mcp.get('citations', []))

    # If MCP did not provide citations, attach top local PPA search matches.
    if not citations and request.message.strip():
        local = await search_ppa_local(request.message, limit=min(request.limit, 8))
        citations = local.results
        warnings.extend(local.warnings)

    evidence_match = _evidence_is_constraint_match(request.message, citations)

    if not evidence_match:
        warnings.append('retrieved evidence does not fully satisfy all query constraints')

    if not reply:
        reply = (
            'The MCP chat bridge is unavailable or returned an empty response. '
            'Chat is MCP-only and does not use model fallback.'
        )

    return ChatResponse(
        reply=reply,
        session_id=session_id,
        model=model,
        warnings=warnings,
        citations=citations,
    )
