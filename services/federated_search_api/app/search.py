from __future__ import annotations

import asyncio
import time

from .clients import (
    SourceResults,
    search_mcp_bridge,
    search_ppa_local,
    search_pride,
    search_proteomexchange,
)
from .schemas import SearchResponse


def _merge_ranked(results: list[list], limit: int):
    flat = [item for group in results for item in group]
    flat.sort(key=lambda record: record.score, reverse=True)
    return flat[:limit]


async def run_federated_search(query: str, limit: int) -> SearchResponse:
    started = time.perf_counter()

    ppa = await search_ppa_local(query, limit=limit)

    pride_task = asyncio.create_task(search_pride(query, limit=limit))
    px_task = asyncio.create_task(search_proteomexchange(query, limit=limit))
    mcp_task = asyncio.create_task(search_mcp_bridge(query, limit=limit))

    pride, proteomexchange, mcp = await asyncio.gather(pride_task, px_task, mcp_task)

    merged = _merge_ranked(
        [
            ppa.results,
            pride.results,
            proteomexchange.results,
            mcp.results,
        ],
        limit=limit,
    )

    warnings: list[str] = []
    for source in [ppa, pride, proteomexchange, mcp]:
        warnings.extend(source.warnings)

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return SearchResponse(
        query=query,
        count=len(merged),
        elapsed_ms=elapsed_ms,
        warnings=warnings,
        results=merged,
    )
