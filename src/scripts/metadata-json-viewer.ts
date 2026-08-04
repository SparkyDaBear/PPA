function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function valueType(value: unknown) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function scalarText(value: unknown) {
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

function collectSearchText(key: string, value: unknown) {
  const values: string[] = [key];
  const collect = (item: unknown) => {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      values.push(String(item));
    } else if (Array.isArray(item)) {
      item.forEach(collect);
    } else if (item && typeof item === 'object') {
      Object.entries(item).forEach(([childKey, childValue]) => {
        values.push(childKey);
        collect(childValue);
      });
    }
  };
  collect(value);
  return normalizeSearchText(values.join(' '));
}

function renderJsonNode(key: string, value: unknown, depth: number): HTMLElement {
  const type = valueType(value);
  const isContainer = type === 'object' || type === 'array';

  if (!isContainer) {
    const row = document.createElement('div');
    row.className = 'metadata-json-scalar';
    row.dataset.ownSearchText = normalizeSearchText(`${key} ${scalarText(value)}`);
    row.dataset.searchText = collectSearchText(key, value);

    const keyEl = document.createElement('span');
    keyEl.className = 'metadata-json-key';
    keyEl.textContent = `${key}:`;
    const valueEl = document.createElement('span');
    valueEl.className = `metadata-json-value is-${type}`;
    valueEl.textContent = scalarText(value);
    row.append(keyEl, valueEl);
    return row;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const details = document.createElement('details');
  details.className = 'metadata-json-node';
  details.open = depth < 2;
  details.dataset.ownSearchText = normalizeSearchText(key);
  details.dataset.searchText = collectSearchText(key, value);

  const summary = document.createElement('summary');
  const keyEl = document.createElement('span');
  keyEl.className = 'metadata-json-key';
  keyEl.textContent = key;
  const countEl = document.createElement('span');
  countEl.className = 'metadata-json-count';
  countEl.textContent = `${type} · ${entries.length}`;
  summary.append(keyEl, countEl);

  const children = document.createElement('div');
  children.className = 'metadata-json-children';
  entries.forEach(([childKey, childValue]) => children.append(renderJsonNode(childKey, childValue, depth + 1)));
  details.append(summary, children);
  return details;
}

function bindViewer(viewer: HTMLDetailsElement) {
  if (viewer.dataset.viewerBound === '1') return;
  viewer.dataset.viewerBound = '1';

  const tree = viewer.querySelector<HTMLElement>('[data-metadata-tree]');
  const search = viewer.querySelector<HTMLInputElement>('[data-metadata-search]');
  const status = viewer.querySelector<HTMLElement>('[data-metadata-status]');
  const expand = viewer.querySelector<HTMLButtonElement>('[data-metadata-expand]');
  const collapse = viewer.querySelector<HTMLButtonElement>('[data-metadata-collapse]');
  const copy = viewer.querySelector<HTMLButtonElement>('[data-metadata-copy]');
  if (!tree || !search || !status || !expand || !collapse || !copy) return;

  let metadata: unknown = null;
  let loading: Promise<void> | null = null;

  const filterTree = () => {
    const tokens = normalizeSearchText(search.value).split(/\s+/).filter(Boolean);
    const nodes = tree.querySelectorAll<HTMLElement>('[data-search-text]');
    let visibleScalars = 0;
    nodes.forEach((node) => {
      node.dataset.directMatch = String(tokens.length > 0 && tokens.every(
        (token) => (node.dataset.ownSearchText || '').includes(token),
      ));
    });
    nodes.forEach((node) => {
      const matchingAncestor = node.parentElement?.closest<HTMLElement>('[data-direct-match="true"]');
      const matches = Boolean(matchingAncestor) || tokens.every(
        (token) => (node.dataset.searchText || '').includes(token),
      );
      node.hidden = !matches;
      if (matches && node.classList.contains('metadata-json-scalar')) visibleScalars += 1;
      if (matches && tokens.length && node instanceof HTMLDetailsElement) node.open = true;
    });
    status.textContent = tokens.length
      ? `${visibleScalars} matching values`
      : 'Showing all public metadata fields.';
  };

  const load = () => {
    if (loading) return loading;
    status.textContent = 'Loading metadata...';
    loading = fetch(viewer.dataset.url || '')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        metadata = payload;
        tree.replaceChildren(renderJsonNode('metadata', payload, 0));
        filterTree();
      })
      .catch(() => {
        status.textContent = 'Metadata could not be loaded.';
        tree.innerHTML = '<p class="empty-state">Open the downloaded JSON file to inspect this record.</p>';
      });
    return loading;
  };

  viewer.addEventListener('toggle', () => {
    if (viewer.open) void load();
  });
  search.addEventListener('input', filterTree);
  expand.addEventListener('click', () => tree.querySelectorAll('details').forEach((node) => { node.open = true; }));
  collapse.addEventListener('click', () => tree.querySelectorAll('details').forEach((node, index) => { node.open = index === 0; }));
  copy.addEventListener('click', async () => {
    await load();
    if (metadata === null) return;
    await navigator.clipboard.writeText(`${JSON.stringify(metadata, null, 2)}\n`);
    copy.textContent = 'Copied';
    window.setTimeout(() => { copy.textContent = 'Copy JSON'; }, 1600);
  });
}

export function initMetadataJsonViewers() {
  document.querySelectorAll<HTMLDetailsElement>('[data-metadata-viewer]').forEach(bindViewer);
}

document.addEventListener('astro:page-load', initMetadataJsonViewers);