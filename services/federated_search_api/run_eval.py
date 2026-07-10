from __future__ import annotations

import json
from pathlib import Path
import time

import httpx


def main() -> int:
    root = Path(__file__).resolve().parent
    queries_path = root / 'eval_queries.json'
    api_base = 'http://127.0.0.1:8787'

    with queries_path.open('r', encoding='utf-8') as handle:
        queries = json.load(handle)

    started = time.time()
    passed = 0

    with httpx.Client(timeout=20.0) as client:
        for item in queries:
            query = item['query']
            expected = [token.lower() for token in item.get('expected_signals', [])]
            response = client.get(f'{api_base}/v1/search', params={'q': query, 'limit': 20})
            response.raise_for_status()
            payload = response.json()

            text_blob = json.dumps(payload).lower()
            ok = all(token in text_blob for token in expected[:1])
            if ok:
                passed += 1

            print(f"[{ 'PASS' if ok else 'FAIL' }] {item['id']}: {query} -> {payload.get('count', 0)} hits")

    duration = round(time.time() - started, 2)
    print(f'\nSummary: {passed}/{len(queries)} passed in {duration}s')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
