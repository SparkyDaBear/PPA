type ProjectSummary = {
  agents: string[];
  treatments: string[];
  cell_system: string[];
  organisms: string[];
  sample_scopes: string[];
  assay: string[];
  search: string;
};
type Classification = { label?: string; confidence?: string; evidence?: string[]; resolution_method?: string };
type L3Node = {
  curie: string;
  label: string;
  definition?: string;
  ontology_id?: string | null;
  membership_type: 'l3' | 'unresolved' | 'no_l3_value';
  is_residual: boolean;
  pxd_count: number;
  pxd_ids: string[];
  values?: string[];
};
type L2Node = {
  curie: string;
  label: string;
  definition?: string;
  pxd_count: number;
  pxd_ids: string[];
  l3_mapped_pxd_count: number;
  is_l1_only?: boolean;
  children: L3Node[];
  classifications: Record<string, Classification>;
};
type L1Node = { curie: string; label: string; definition?: string; pxd_count: number; children: L2Node[] };
type Payload = { branch: string; pxd_count: number; l1_nodes: L1Node[]; projects: Record<string, ProjectSummary> };
type Options = { dataUrl: string; baseUrl: string; l2Noun: string };

const L3_FILTER_THRESHOLD = 25;

function sortByCountThenLabel<T extends { pxd_count: number; label: string }>(left: T, right: T) {
  return right.pxd_count - left.pxd_count
    || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
    || left.label.localeCompare(right.label);
}

// Specific classes first, residual buckets (unresolved / no value / L1-only) last.
function residualLast<T extends { pxd_count: number; label: string }>(isResidual: (node: T) => boolean) {
  return (left: T, right: T) => Number(isResidual(left)) - Number(isResidual(right)) || sortByCountThenLabel(left, right);
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

function list(values: unknown): string {
  if (!Array.isArray(values)) return 'Not reported';
  const labels = values
    .map((item) => (item && typeof item === 'object' ? (item as any).label : item))
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
  return labels.length ? [...new Set(labels)].join(', ') : 'Not reported';
}

function normalizeSearchText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matches(text: string, query: string) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  return tokens.every((token) => text.includes(token));
}

function renderDetail(pxd: string, record: any, classification: Classification | undefined, baseUrl: string) {
  const summary = record?.summary || {};
  const design = record?.experimental_design || {};
  const assay = record?.assay || {};
  const source = assay.biological_source || {};
  const attributes = (record?.treatment?.attributes || [])
    .map((item: any) => [item.agent, item.dose_or_concentration, item.duration, item.route_or_context].filter(Boolean).join(' · '))
    .filter(Boolean);
  const scopes = (assay.sample_scopes || []).map((entry: any) => (entry.detail ? `${entry.category} (${entry.detail})` : entry.category));
  const evidence = classification?.evidence || [];
  const links = Object.entries(record?.source_links || {})
    .filter(([, href]) => Boolean(href))
    .map(([name, href]) => `<a class="badge" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(name.replace(/_url$/, '').replace(/_/g, ' '))}</a>`)
    .join(' ');
  return `<p class="detail-kicker">${escapeHtml(classification?.confidence ? `${classification.confidence} confidence` : 'Project metadata')}</p>
    <div class="detail-header"><h3>${escapeHtml(pxd)}</h3><a class="badge" href="${baseUrl}projects/${encodeURIComponent(pxd)}/">Full project</a></div>
    <p class="row-meta">${escapeHtml(record?.title || 'No project title exported.')}</p>
    <dl class="metadata-grid">
      <div><dt>Annotation</dt><dd>${escapeHtml(classification?.label || 'Not reported')}</dd></div>
      <div><dt>Sample scope</dt><dd>${escapeHtml(scopes.join('; ') || 'Not reported')}</dd></div>
      <div><dt>Organism</dt><dd>${escapeHtml(list(source.organisms))}</dd></div>
      <div><dt>Cell system</dt><dd>${escapeHtml([list(source.cell_lines), list(source.cell_types)].filter((item) => item !== 'Not reported').join('; ') || 'Not reported')}</dd></div>
      <div><dt>Tissue or other source</dt><dd>${escapeHtml(list(source.noncellular_sources))}</dd></div>
      <div><dt>Sex</dt><dd>${escapeHtml(source.sex || 'Not reported')}</dd></div>
      <div><dt>Assay</dt><dd>${escapeHtml([summary.acquisition_type, ...(summary.labeling_strategy || [])].filter(Boolean).join(' · ') || 'Not reported')}</dd></div>
      <div><dt>Reference condition</dt><dd>${escapeHtml(list(design.control_arms))}</dd></div>
      <div><dt>Experimental conditions</dt><dd>${escapeHtml(list(design.case_arms))}</dd></div>
    </dl>
    <section class="detail-block"><h4>Treatment attributes</h4><p>${escapeHtml(attributes.join('; ') || 'Not reported')}</p></section>
    <section class="detail-block"><h4>Evidence</h4>${evidence.length ? `<ul class="plain-list">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Not reported</p>'}</section>
    <section class="detail-block"><h4>Sources</h4><div class="detail-links">${links || 'No source links exported.'}</div></section>`;
}

export async function initBranchBrowser({ dataUrl, baseUrl, l2Noun }: Options) {
  const get = (id: string) => document.getElementById(id);
  const l1El = get('browser-l1');
  const l2El = get('browser-l2');
  const l2TitleEl = get('browser-l2-title');
  const l3El = get('browser-l3');
  const l3TitleEl = get('browser-l3-title');
  const l3FilterEl = get('browser-l3-filter') as HTMLInputElement | null;
  const totalEl = get('browser-total');
  const resultsTitleEl = get('results-title');
  const definitionEl = get('results-definition');
  const resultsCountEl = get('results-count');
  const projectListEl = get('browser-projects');
  const detailEl = get('browser-project-detail');
  const filterEl = get('browser-project-filter') as HTMLInputElement | null;
  if (!l1El || !l2El || !l2TitleEl || !l3El || !l3TitleEl || !l3FilterEl || !totalEl || !resultsTitleEl || !definitionEl || !resultsCountEl || !projectListEl || !detailEl || !filterEl) return;

  const recordCache = new Map<string, Promise<any>>();
  const loadRecord = (pxd: string) => {
    if (!recordCache.has(pxd)) {
      recordCache.set(pxd, fetch(`${baseUrl}export/pxd/${encodeURIComponent(pxd)}.json`).then((response) => (response.ok ? response.json() : null)).catch(() => null));
    }
    return recordCache.get(pxd) as Promise<any>;
  };

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as Payload;
    const searchText = new Map(Object.entries(payload.projects).map(([pxd, summary]) => [pxd, normalizeSearchText(`${pxd} ${summary.search}`)]));
    const l1Nodes = payload.l1_nodes.filter((node) => node.pxd_count > 0).sort(sortByCountThenLabel);
    let selectedL1 = l1Nodes[0];
    let selectedL2: L2Node | null = null;
    let selectedL3: L3Node | null = null;
    let selectedPxd: string | null = null;
    totalEl.textContent = `${payload.pxd_count} studies · ${l1Nodes.length} categories`;

    const showDetail = async (pxd: string | null) => {
      selectedPxd = pxd;
      if (!pxd || !selectedL2) {
        detailEl.innerHTML = '<p class="empty-state">No studies match this selection.</p>';
        return;
      }
      const classification = selectedL2.classifications[pxd];
      detailEl.innerHTML = `<p class="detail-kicker">Loading</p><h3>${escapeHtml(pxd)}</h3>`;
      const record = await loadRecord(pxd);
      if (selectedPxd === pxd) detailEl.innerHTML = renderDetail(pxd, record, classification, baseUrl);
    };

    const rowMeta = (summary: ProjectSummary | undefined) =>
      [summary?.agents.join(', '), summary?.cell_system.join(', '), summary?.organisms.join(', ')].filter(Boolean).join(' · ') || 'Not reported';

    const renderProjects = () => {
      if (!selectedL2) return;
      const query = filterEl.value.trim();
      const basePxds = selectedL3 ? selectedL3.pxd_ids : selectedL2.pxd_ids;
      const pxds = basePxds.filter((pxd) => !query || matches(searchText.get(pxd) || pxd.toLowerCase(), query));
      if (!pxds.includes(selectedPxd || '')) void showDetail(pxds[0] || null);
      resultsCountEl.textContent = `${pxds.length} of ${basePxds.length} studies`;
      projectListEl.innerHTML = pxds.length
        ? pxds.map((pxd) => {
          const summary = payload.projects[pxd];
          const classification = selectedL2?.classifications[pxd];
          return `<button class="treatment-project-row${selectedPxd === pxd ? ' is-selected' : ''}" data-pxd="${escapeHtml(pxd)}"><span class="row-head"><strong>${escapeHtml(pxd)}</strong><span class="row-code">${escapeHtml(classification?.confidence || summary?.sample_scopes.join(' · ') || '')}</span></span><span>${escapeHtml(classification?.label || summary?.treatments.join(', ') || '')}</span><span class="row-meta">${escapeHtml(rowMeta(summary))}</span></button>`;
        }).join('')
        : '<p class="empty-state">No studies match this filter.</p>';
      projectListEl.querySelectorAll<HTMLButtonElement>('[data-pxd]').forEach((button) => button.addEventListener('click', () => {
        void showDetail(button.dataset.pxd || null);
        projectListEl.querySelectorAll('.is-selected').forEach((element) => element.classList.remove('is-selected'));
        button.classList.add('is-selected');
      }));
    };

    const selectL3 = (node: L3Node | null) => {
      if (!selectedL2) return;
      selectedL3 = node;
      filterEl.value = '';
      resultsTitleEl.textContent = node ? `${selectedL2.label} › ${node.label}` : selectedL2.label;
      definitionEl.textContent = (node ? [node.definition, node.ontology_id && !node.ontology_id.includes('#') ? `ID: ${node.ontology_id}` : ''].filter(Boolean).join(' · ') : selectedL2.definition) || 'No ontology definition exported.';
      history.replaceState(null, '', `#${encodeURIComponent(node?.curie || selectedL2.curie)}`);
      selectedPxd = null;
      renderL3();
      renderProjects();
    };

    const renderL3 = () => {
      if (!selectedL2) {
        l3TitleEl.textContent = `Choose a ${l2Noun}`;
        l3FilterEl.hidden = true;
        l3El.innerHTML = '<p class="empty-state">Select Level 2 to inspect its Level 3 classes.</p>';
        return;
      }
      l3TitleEl.textContent = selectedL2.label;
      l3FilterEl.hidden = selectedL2.children.length < L3_FILTER_THRESHOLD;
      const query = l3FilterEl.hidden ? '' : l3FilterEl.value.trim();
      const allButton = `<button class="treatment-node treatment-node-l3${selectedL3 ? '' : ' is-selected'}" data-l3-curie=""><span>All studies</span><strong>${selectedL2.pxd_count}</strong></button>`;
      const children = [...selectedL2.children]
        .filter((node) => !query || node === selectedL3 || matches(normalizeSearchText(`${node.label} ${(node.values || []).join(' ')}`), query))
        .sort(residualLast((node: L3Node) => node.is_residual))
        .map((node) => `<button class="treatment-node treatment-node-l3${node.is_residual ? ' treatment-node-l3-residual' : ''}${selectedL3?.curie === node.curie ? ' is-selected' : ''}${node.pxd_count === 0 ? ' is-zero-count' : ''}" data-l3-curie="${escapeHtml(node.curie)}" title="${escapeHtml(node.definition || '')}"><span>${escapeHtml(node.label)}</span><strong>${node.pxd_count}</strong></button>`).join('');
      const empty = selectedL2.is_l1_only ? '<p class="empty-state">Level 2 was not specified, so there are no Level 3 classes.</p>' : '';
      l3El.innerHTML = allButton + (children || empty);
      l3El.querySelectorAll<HTMLButtonElement>('[data-l3-curie]').forEach((button) => button.addEventListener('click', () => {
        const node = button.dataset.l3Curie ? selectedL2?.children.find((child) => child.curie === button.dataset.l3Curie) || null : null;
        selectL3(node);
      }));
    };

    const selectL2 = (node: L2Node) => {
      selectedL2 = node;
      selectedL3 = null;
      selectedPxd = null;
      filterEl.disabled = false;
      filterEl.value = '';
      l3FilterEl.value = '';
      resultsTitleEl.textContent = node.label;
      definitionEl.textContent = node.definition || 'No ontology definition exported.';
      history.replaceState(null, '', `#${encodeURIComponent(node.curie)}`);
      renderL2();
      renderL3();
      renderProjects();
    };

    const renderL2 = () => {
      l2TitleEl.textContent = selectedL1.label;
      l2El.innerHTML = [...selectedL1.children]
        .sort(residualLast((node: L2Node) => Boolean(node.is_l1_only)))
        .map((node) => `<button class="treatment-node treatment-node-l2${node.is_l1_only ? ' treatment-node-l3-residual' : ''}${selectedL2?.curie === node.curie ? ' is-selected' : ''}${node.pxd_count === 0 ? ' is-zero-count' : ''}" data-curie="${escapeHtml(node.curie)}"><span>${escapeHtml(node.label)}</span><strong>${node.pxd_count}</strong></button>`).join('');
      l2El.querySelectorAll<HTMLButtonElement>('[data-curie]').forEach((button) => button.addEventListener('click', () => {
        const node = selectedL1.children.find((child) => child.curie === button.dataset.curie);
        if (node) selectL2(node);
      }));
    };

    const renderL1 = () => {
      l1El.innerHTML = l1Nodes.map((node) => `<button class="treatment-node${selectedL1.curie === node.curie ? ' is-selected' : ''}" data-curie="${escapeHtml(node.curie)}"><span>${escapeHtml(node.label)}</span><strong>${node.pxd_count}</strong></button>`).join('');
      l1El.querySelectorAll<HTMLButtonElement>('[data-curie]').forEach((button) => button.addEventListener('click', () => {
        const node = l1Nodes.find((item) => item.curie === button.dataset.curie);
        if (!node) return;
        selectedL1 = node;
        selectedL2 = null;
        selectedL3 = null;
        selectedPxd = null;
        filterEl.disabled = true;
        resultsTitleEl.textContent = `Select a ${l2Noun}`;
        definitionEl.textContent = node.definition || 'Select a Level 2 class to see all studies, then optionally refine them with Level 3.';
        resultsCountEl.textContent = '';
        projectListEl.innerHTML = '';
        detailEl.innerHTML = `<p class="detail-kicker">Project metadata</p><h3>Select a study</h3><p class="row-meta">Choose a Level 2 ${escapeHtml(l2Noun)} first.</p>`;
        renderL1();
        renderL2();
        renderL3();
      }));
    };

    filterEl.addEventListener('input', renderProjects);
    l3FilterEl.addEventListener('input', renderL3);
    const requested = decodeURIComponent(window.location.hash.slice(1));
    const ownsRequest = (l2: L2Node) => l2.curie === requested || l2.children.some((child) => child.curie === requested);
    const requestedL1 = l1Nodes.find((node) => node.curie === requested || node.children.some(ownsRequest));
    if (requestedL1) selectedL1 = requestedL1;
    renderL1();
    renderL2();
    renderL3();
    const requestedL2 = selectedL1.children.find(ownsRequest);
    if (requestedL2) {
      selectL2(requestedL2);
      const requestedL3 = requestedL2.children.find((child) => child.curie === requested);
      if (requestedL3) selectL3(requestedL3);
    }
  } catch {
    totalEl.textContent = 'Explorer data could not be loaded.';
    l1El.innerHTML = '<p class="empty-state">Rebuild the public export to create the browser JSON.</p>';
  }
}
