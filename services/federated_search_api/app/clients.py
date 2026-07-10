from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import re
from typing import Any
from xml.etree import ElementTree

import httpx

from .schemas import ChatTurn, SearchResult
from .settings import settings


def _tokenize(query: str) -> list[str]:
    return [chunk for chunk in query.lower().strip().split() if chunk]


def _contains_score(text: str, tokens: list[str]) -> float:
    if not text:
        return 0.0
    normalized = text.lower()
    hits = sum(1 for token in tokens if token in normalized)
    if hits == 0:
        return 0.0
    return hits / max(len(tokens), 1)


def _safe_read_json(path: Path) -> Any:
    if not path.exists():
        return None
    with path.open('r', encoding='utf-8') as handle:
        return json.load(handle)


async def _fetch_json(url: str) -> Any:
    async with httpx.AsyncClient(timeout=settings.ppa_export_fetch_timeout_seconds) as client:
        response = await client.get(url, headers={'Accept': 'application/json'})
        response.raise_for_status()
        return response.json()


@dataclass
class SourceResults:
    results: list[SearchResult]
    warnings: list[str]


async def search_ppa_local(query: str, limit: int) -> SourceResults:
    tokens = _tokenize(query)
    results: list[SearchResult] = []
    warnings: list[str] = []

    term_index = None
    pxd_index = None
    term_source = 'public/PPA/export/term_index.json'
    pxd_source = 'public/PPA/export/pxd_index.json'

    # Prefer public hosted export files for cloud deployment.
    if settings.ppa_export_base_url.strip():
        base = settings.ppa_export_base_url.rstrip('/')
        try:
            term_index = await _fetch_json(f'{base}/term_index.json')
            pxd_index = await _fetch_json(f'{base}/pxd_index.json')
            term_source = f'{base}/term_index.json'
            pxd_source = f'{base}/pxd_index.json'
        except Exception as exc:
            warnings.append(f'ppa remote export unavailable, using local fallback: {exc}')

    # Fallback for local/private execution.
    if term_index is None or pxd_index is None:
        export_dir = Path(settings.ppa_export_dir)
        if term_index is None:
            term_index = _safe_read_json(export_dir / 'term_index.json')
        if pxd_index is None:
            pxd_index = _safe_read_json(export_dir / 'pxd_index.json')

    if term_index is None:
        warnings.append('ppa term_index.json not found')
        term_index = []
    if pxd_index is None:
        warnings.append('ppa pxd_index.json not found')
        pxd_index = {'projects': []}

    for term in term_index:
        label = term.get('preferred_label', '')
        curie = term.get('curie', '')
        synonyms = ' '.join(term.get('synonyms') or [])
        haystack = f"{label} {curie} {synonyms}"
        score = 0.75 * _contains_score(haystack, tokens)
        if score <= 0:
            continue
        results.append(
            SearchResult(
                source='ppa',
                kind='term',
                score=min(score + 0.2, 1.0),
                title=label or curie,
                subtitle=curie,
                snippet=term.get('definition_snippet') or 'Ontology term',
                link=f"{settings.ppa_public_base_url}/terms/{httpx.QueryParams({'x': curie})['x']}/",
                provenance=term_source,
            )
        )

    for project in (pxd_index or {}).get('projects', []):
        pxd = project.get('pxd', '')
        summary = project.get('summary') or {}
        acquisition = summary.get('acquisition_type') or ''
        quant = summary.get('quantification_method') or ''
        scope = summary.get('sample_scope_label') or ''
        instrument = summary.get('instrument') or ''
        labels = ' '.join(summary.get('labeling_strategy') or [])

        haystack = f"{pxd} {acquisition} {quant} {scope} {labels} {instrument}"
        score = _contains_score(haystack, tokens)
        if score <= 0:
            continue

        subtitle = ' · '.join([value for value in [acquisition, quant, labels] if value]) or 'Project metadata'
        results.append(
            SearchResult(
                source='ppa',
                kind='project',
                score=min(score + 0.15, 1.0),
                title=pxd,
                subtitle=subtitle,
                snippet=instrument or 'No instrument exported yet.',
                link=f"{settings.ppa_public_base_url}/projects/{pxd}/",
                provenance=pxd_source,
            )
        )

    results.sort(key=lambda item: item.score, reverse=True)
    return SourceResults(results=results[:limit], warnings=warnings)


async def search_pride(query: str, limit: int) -> SourceResults:
    if not settings.enable_pride:
        return SourceResults(results=[], warnings=[])

    endpoint = 'https://www.ebi.ac.uk/pride/ws/archive/v2/search/projects'
    headers = {'Accept': 'application/json'}
    if settings.pride_api_key:
        headers['Authorization'] = f'Bearer {settings.pride_api_key}'

    params = {'keyword': query, 'page': 0, 'pageSize': min(limit, 25)}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(endpoint, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        return SourceResults(results=[], warnings=[f'pride source unavailable: {exc}'])

    rows = payload if isinstance(payload, list) else payload.get('list', []) if isinstance(payload, dict) else []
    mapped: list[SearchResult] = []
    for row in rows:
        accession = row.get('accession') or row.get('projectAccession') or 'PRIDE project'
        title = row.get('title') or row.get('projectTitle') or accession
        summary = row.get('projectDescription') or row.get('description') or ''
        score = 0.6
        mapped.append(
            SearchResult(
                source='pride',
                kind='project',
                score=score,
                title=title,
                subtitle=accession,
                snippet=summary[:240] if summary else None,
                link=f'https://www.ebi.ac.uk/pride/archive/projects/{accession}' if accession else None,
                provenance='PRIDE Archive API v2',
            )
        )

    return SourceResults(results=mapped[:limit], warnings=[])


async def search_proteomexchange(query: str, limit: int) -> SourceResults:
    if not settings.enable_proteomexchange:
        return SourceResults(results=[], warnings=[])

    accession_matches = re.findall(r'PXD\d{6}', query.upper())
    accessions = list(dict.fromkeys(accession_matches))[: max(1, min(limit, 10))]
    if not accessions:
        warning = 'proteomexchange query currently supports accession lookup (for example: PXD000005)'
        return SourceResults(results=[], warnings=[warning])

    headers = {'Accept': 'application/xml'}
    if settings.proteomexchange_api_key:
        headers['X-Api-Key'] = settings.proteomexchange_api_key

    mapped: list[SearchResult] = []
    warnings: list[str] = []
    endpoint = 'https://proteomecentral.proteomexchange.org/cgi/GetDataset'

    async with httpx.AsyncClient(timeout=15.0) as client:
        for accession in accessions:
            try:
                response = await client.get(
                    endpoint,
                    params={'ID': accession, 'outputMode': 'XML'},
                    headers=headers,
                )
                response.raise_for_status()

                root = ElementTree.fromstring(response.text)
                title = root.findtext('.//title') or accession
                summary = root.findtext('.//description') or root.findtext('.//summary') or ''
                px_accession = root.findtext('.//identifier') or accession

                if 'not found' in response.text.lower() and not root.findall('.//Dataset'):
                    warnings.append(f'proteomexchange accession not found: {accession}')
                    continue

                mapped.append(
                    SearchResult(
                        source='proteomexchange',
                        kind='project',
                        score=0.58,
                        title=title,
                        subtitle=px_accession,
                        snippet=summary[:240] if summary else None,
                        link=f'https://proteomecentral.proteomexchange.org/cgi/GetDataset?ID={px_accession}',
                        provenance='ProteomeXchange GetDataset XML',
                    )
                )
            except Exception as exc:
                warnings.append(f'proteomexchange source unavailable for {accession}: {exc}')

    return SourceResults(results=mapped[:limit], warnings=warnings)


async def search_mcp_bridge(query: str, limit: int) -> SourceResults:
    if not settings.enable_mcp_source or not settings.mcp_bridge_url:
        return SourceResults(results=[], warnings=[])

    headers = {'Accept': 'application/json'}
    if settings.mcp_bridge_token:
        headers['Authorization'] = f'Bearer {settings.mcp_bridge_token}'

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                settings.mcp_bridge_url,
                headers=headers,
                json={'query': query, 'limit': limit},
            )
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        return SourceResults(results=[], warnings=[f'mcp bridge unavailable: {exc}'])

    items = payload.get('results', []) if isinstance(payload, dict) else []
    mapped: list[SearchResult] = []
    for item in items:
        mapped.append(
            SearchResult(
                source='mcp',
                kind=item.get('kind', 'record'),
                score=float(item.get('score', 0.5)),
                title=item.get('title', 'MCP result'),
                subtitle=item.get('subtitle'),
                snippet=item.get('snippet'),
                link=item.get('link'),
                provenance=item.get('provenance', 'MCP bridge'),
            )
        )

    return SourceResults(results=mapped[:limit], warnings=[])


async def chat_mcp_bridge(message: str, history: list[ChatTurn], session_id: str | None, limit: int) -> dict[str, Any]:
    if not settings.enable_mcp_source:
        return {'warnings': ['mcp source is disabled'], 'reply': ''}

    endpoint = settings.mcp_chat_bridge_url or settings.mcp_bridge_url
    if not endpoint:
        return {'warnings': ['mcp chat bridge URL is not configured'], 'reply': ''}

    headers = {'Accept': 'application/json'}
    if settings.mcp_bridge_token:
        headers['Authorization'] = f'Bearer {settings.mcp_bridge_token}'

    payload = {
        'message': message,
        'history': [turn.model_dump() for turn in history],
        'session_id': session_id,
        'limit': limit,
    }

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            body = response.json()
    except Exception as exc:
        return {'warnings': [f'mcp chat bridge unavailable: {exc}'], 'reply': ''}

    return {
        'reply': body.get('reply') or body.get('content') or '',
        'session_id': body.get('session_id') or session_id,
        'model': body.get('model'),
        'citations': body.get('citations', []),
        'warnings': body.get('warnings', []),
    }


async def chat_openai_fallback(message: str, history: list[ChatTurn]) -> dict[str, Any]:
    if not settings.openai_api_key:
        return {'warnings': ['openai fallback is not configured'], 'reply': ''}

    return {
        'warnings': ['openai fallback called without retrieval context'],
        'reply': '',
    }


async def chat_openai_fallback_grounded(
    query: str,
    citations: list[SearchResult],
    history: list[ChatTurn],
) -> dict[str, Any]:
    if not settings.openai_api_key:
        return {'warnings': ['openai fallback is not configured'], 'reply': ''}

    headers = {
        'Authorization': f'Bearer {settings.openai_api_key}',
        'Content-Type': 'application/json',
    }
    endpoint = f"{settings.openai_base_url.rstrip('/')}/chat/completions"

    evidence_lines = []
    for idx, citation in enumerate(citations[:12], start=1):
        evidence_lines.append(
            (
                f"[{idx}] source={citation.source}; kind={citation.kind}; score={citation.score:.3f}; "
                f"title={citation.title}; subtitle={citation.subtitle or ''}; "
                f"snippet={citation.snippet or ''}; link={citation.link or ''}"
            )
        )

    evidence_block = '\n'.join(evidence_lines) if evidence_lines else '[none]'

    system_prompt = (
        'You are a retrieval-grounded assistant for proteomics dataset search. '
        'Use only the provided EVIDENCE lines. Do not fabricate studies or claims. '
        'If evidence is insufficient for the requested constraint, say that explicitly and '
        'suggest a concise follow-up query. Keep answers concise and practical.\n\n'
        f'EVIDENCE:\n{evidence_block}'
    )

    messages = [{'role': 'system', 'content': system_prompt}]
    messages.extend(turn.model_dump() for turn in history)
    messages.append({'role': 'user', 'content': query})

    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                endpoint,
                headers=headers,
                json={
                    'model': settings.openai_model,
                    'messages': messages,
                    'temperature': 0.0,
                },
            )
            response.raise_for_status()
            body = response.json()
    except Exception as exc:
        return {'warnings': [f'openai fallback unavailable: {exc}'], 'reply': ''}

    choice = (body.get('choices') or [{}])[0]
    reply = ((choice.get('message') or {}).get('content') or '').strip()
    return {
        'reply': reply,
        'model': body.get('model') or settings.openai_model,
        'warnings': [],
        'citations': [],
    }
