type Project = {
  pxd: string;
  title?: string | null;
  classification: { label?: string; confidence?: string; evidence?: string[] };
  treatment_attributes?: Array<{ agent?: string; dose_or_concentration?: string; duration?: string; route_or_context?: string }>;
  summary?: Record<string, unknown>;
  experimental_design?: Record<string, unknown>;
  source_links?: Record<string, string | null>;
};

type L3Node = { curie: string; key: string; label: string; definition?: string; pxd_count: number; pxd_ids: string[]; is_residual?: boolean };
type L2Node = { curie: string; label: string; definition?: string; pxd_count: number; l3_mapped_pxd_count: number; children: L3Node[]; projects: Project[] };
type L1Node = { curie: string; label: string; pxd_count: number; children: L2Node[] };
type Options = { dataUrl: string; baseUrl: string };

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] || character);
}

function displayList(value: unknown) {
  return Array.isArray(value) && value.length ? value.filter((item): item is string => typeof item === 'string').join(', ') : 'Not reported';
}

function renderDetail(project: Project, baseUrl: string) {
  const summary = project.summary || {};
  const design = project.experimental_design || {};
  const attributes = (project.treatment_attributes || []).map((item) => [item.agent, item.dose_or_concentration, item.duration, item.route_or_context].filter(Boolean).join(' · ')).filter(Boolean);
  const agents = [...new Set((project.treatment_attributes || []).map((item) => item.agent).filter(Boolean))];
  const evidence = (project.classification.evidence || []).slice(0, 2);
  const links = Object.entries(project.source_links || {}).filter(([, href]) => Boolean(href)).map(([name, href]) => `<a class="badge" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(name.replace(/_url$/, '').replace(/_/g, ' '))}</a>`).join(' ');
  return `<p class="detail-kicker">${escapeHtml(project.classification.confidence || 'unrated')} confidence</p>
    <div class="detail-header"><h3>${escapeHtml(project.pxd)}</h3><a class="badge" href="${baseUrl}projects/${encodeURIComponent(project.pxd)}/">Full project</a></div>
    <p class="row-meta">${escapeHtml(project.title || 'No project title exported.')}</p>
    <dl class="metadata-grid">
      <div><dt>Treatment class</dt><dd>${escapeHtml(project.classification.label)}</dd></div>
      <div><dt>Sample scope</dt><dd>${escapeHtml(summary.sample_scope_label || summary.sample_scope || 'Not reported')}</dd></div>
      <div><dt>Cell system</dt><dd>${escapeHtml(displayList(summary.cell_lines || summary.cell_types))}</dd></div>
      <div><dt>Treatment agents</dt><dd>${escapeHtml(agents.join(', ') || 'Not reported')}</dd></div>
      <div><dt>Assay</dt><dd>${escapeHtml([summary.acquisition_type, displayList(summary.labeling_strategy)].filter((item) => item !== 'Not reported').join(' · ') || 'Not reported')}</dd></div>
      <div><dt>Reference condition</dt><dd>${escapeHtml(displayList(design.control_arms))}</dd></div>
      <div><dt>Experimental conditions</dt><dd>${escapeHtml(displayList(design.case_arms))}</dd></div>
    </dl>
    <section class="detail-block"><h4>Treatment attributes</h4><p>${escapeHtml(attributes.join('; ') || 'Not reported')}</p></section>
    <section class="detail-block"><h4>Evidence</h4>${evidence.length ? `<ul class="plain-list">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Not reported</p>'}</section>
    <section class="detail-block"><h4>Sources</h4><div class="detail-links">${links || 'No source links exported.'}</div></section>`;
}

export async function initTreatmentBrowser({ dataUrl, baseUrl }: Options) {
  const get = (id: string) => document.getElementById(id);
  const l1El = get('treatment-l1');
  const l2El = get('treatment-l2');
  const l2TitleEl = get('treatment-l2-title');
  const l3El = get('treatment-l3');
  const l3TitleEl = get('treatment-l3-title');
  const totalEl = get('browser-total');
  const resultsTitleEl = get('results-title');
  const definitionEl = get('results-definition');
  const resultsCountEl = get('results-count');
  const projectListEl = get('treatment-projects');
  const detailEl = get('treatment-project-detail');
  const filterEl = get('treatment-project-filter') as HTMLInputElement | null;
  if (!l1El || !l2El || !l2TitleEl || !l3El || !l3TitleEl || !totalEl || !resultsTitleEl || !definitionEl || !resultsCountEl || !projectListEl || !detailEl || !filterEl) return;

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { l1_nodes: L1Node[] };
    const l1Nodes = payload.l1_nodes.filter((node) => node.pxd_count > 0);
    let selectedL1 = l1Nodes[0];
    let selectedL2: L2Node | null = null;
    let selectedL3: L3Node | null = null;
    let showMappedL3 = false;
    let showUnmappedL3 = false;
    let selectedProject: Project | null = null;
    totalEl.textContent = `${l1Nodes.length} treatment categories`;

    const renderProjects = () => {
      if (!selectedL2) return;
      const query = filterEl.value.trim().toLowerCase();
      const mappedPxds = new Set(selectedL2.children.filter((node) => !node.is_residual).flatMap((node) => node.pxd_ids));
      const allowedPxds = selectedL3 ? new Set(selectedL3.pxd_ids) : null;
      const baseProjects = showMappedL3
        ? selectedL2.projects.filter((project) => mappedPxds.has(project.pxd))
        : showUnmappedL3
        ? selectedL2.projects.filter((project) => !mappedPxds.has(project.pxd))
        : allowedPxds ? selectedL2.projects.filter((project) => allowedPxds.has(project.pxd)) : selectedL2.projects;
      const projects = baseProjects.filter((project) => JSON.stringify(project).toLowerCase().includes(query));
      resultsCountEl.textContent = `${projects.length} of ${baseProjects.length} studies`;
      projectListEl.innerHTML = projects.length ? projects.map((project) => `<button class="treatment-project-row${selectedProject?.pxd === project.pxd ? ' is-selected' : ''}" data-pxd="${escapeHtml(project.pxd)}"><span class="row-head"><strong>${escapeHtml(project.pxd)}</strong><span class="row-code">${escapeHtml(project.classification.confidence || 'unrated')}</span></span><span>${escapeHtml(project.title || project.classification.label || 'Untitled project')}</span><span class="row-meta">${escapeHtml((project.treatment_attributes || []).map((item) => item.agent).filter(Boolean).join(', ') || String(project.summary?.sample_scope_label || project.summary?.sample_scope || 'Not reported'))}</span></button>`).join('') : '<p class="empty-state">No studies match this filter.</p>';
      projectListEl.querySelectorAll<HTMLButtonElement>('[data-pxd]').forEach((button) => button.addEventListener('click', () => {
        selectedProject = selectedL2?.projects.find((project) => project.pxd === button.dataset.pxd) || null;
        if (selectedProject) detailEl.innerHTML = renderDetail(selectedProject, baseUrl);
        renderProjects();
      }));
    };

    const selectL3 = (node: L3Node | null, mapped = false, unmapped = false) => {
      if (!selectedL2) return;
      selectedL3 = node;
      showMappedL3 = mapped;
      showUnmappedL3 = unmapped;
      const mappedPxds = new Set(selectedL2.children.filter((child) => !child.is_residual).flatMap((child) => child.pxd_ids));
      selectedProject = mapped
        ? selectedL2.projects.find((project) => mappedPxds.has(project.pxd)) || null
        : unmapped
        ? selectedL2.projects.find((project) => !mappedPxds.has(project.pxd)) || null
        : node
        ? selectedL2.projects.find((project) => node.pxd_ids.includes(project.pxd)) || null
        : selectedL2.projects[0] || null;
      filterEl.value = '';
      resultsTitleEl.textContent = mapped ? 'Mapped to Level 3' : unmapped ? 'Unmapped to Level 3' : node?.label || selectedL2.label;
      definitionEl.textContent = mapped
        ? 'Studies with at least one evidence-backed Level 3 assignment. A study may belong to multiple Level 3 classes.'
        : unmapped
        ? 'Studies assigned to this Level 2 class without an evidence-backed Level 3 mapping.'
        : node?.definition || selectedL2.definition || 'No ontology definition exported.';
      detailEl.innerHTML = selectedProject ? renderDetail(selectedProject, baseUrl) : '<p class="empty-state">No projects are currently mapped to this Level 3 class.</p>';
      history.replaceState(null, '', `#${encodeURIComponent(node?.curie || selectedL2.curie)}`);
      renderL3();
      renderProjects();
    };

    const renderL3 = () => {
      if (!selectedL2) {
        l3TitleEl.textContent = 'Choose a treatment class';
        l3El.innerHTML = '<p class="empty-state">Select Level 2 to inspect its fine-grained classes.</p>';
        return;
      }
      l3TitleEl.textContent = selectedL2.label;
      const unmappedCount = selectedL2.pxd_count - selectedL2.l3_mapped_pxd_count;
      const allButton = `<button class="treatment-node treatment-node-l3${selectedL3 || showMappedL3 || showUnmappedL3 ? '' : ' is-selected'}" data-l3-curie=""><span>All studies</span><strong>${selectedL2.pxd_count}</strong></button>`;
      const mappedButton = `<button class="treatment-node treatment-node-l3${showMappedL3 ? ' is-selected' : ''}${selectedL2.l3_mapped_pxd_count === 0 ? ' is-zero-count' : ''}" data-l3-mapped><span>Mapped to Level 3</span><strong>${selectedL2.l3_mapped_pxd_count}</strong></button>`;
      const unmappedButton = `<button class="treatment-node treatment-node-l3${showUnmappedL3 ? ' is-selected' : ''}${unmappedCount === 0 ? ' is-zero-count' : ''}" data-l3-unmapped><span>Unmapped to Level 3</span><strong>${unmappedCount}</strong></button>`;
      const children = [...(selectedL2.children || [])]
        .sort((left, right) => Number(Boolean(left.is_residual)) - Number(Boolean(right.is_residual)) || right.pxd_count - left.pxd_count || left.label.localeCompare(right.label))
        .map((node) => `<button class="treatment-node treatment-node-l3${node.is_residual ? ' treatment-node-l3-residual' : ''}${selectedL3?.curie === node.curie ? ' is-selected' : ''}${node.pxd_count === 0 ? ' is-zero-count' : ''}" data-l3-curie="${escapeHtml(node.curie)}"><span>${escapeHtml(node.label)}</span><strong>${node.pxd_count}</strong></button>`).join('');
      l3El.innerHTML = allButton + mappedButton + unmappedButton + children;
      l3El.querySelectorAll<HTMLButtonElement>('[data-l3-curie]').forEach((button) => button.addEventListener('click', () => {
        const node = button.dataset.l3Curie ? selectedL2?.children.find((child) => child.curie === button.dataset.l3Curie) || null : null;
        selectL3(node);
      }));
      l3El.querySelector<HTMLButtonElement>('[data-l3-mapped]')?.addEventListener('click', () => selectL3(null, true));
      l3El.querySelector<HTMLButtonElement>('[data-l3-unmapped]')?.addEventListener('click', () => selectL3(null, false, true));
    };

    const renderL2 = () => {
      l2TitleEl.textContent = selectedL1.label;
      l2El.innerHTML = selectedL1.children.map((node) => `<button class="treatment-node treatment-node-l2${selectedL2?.curie === node.curie ? ' is-selected' : ''}" data-curie="${escapeHtml(node.curie)}"><span>${escapeHtml(node.label)}</span><strong>${node.pxd_count}</strong></button>`).join('');
      l2El.querySelectorAll<HTMLButtonElement>('[data-curie]').forEach((button) => button.addEventListener('click', () => {
        const node = selectedL1.children.find((child) => child.curie === button.dataset.curie);
        if (!node) return;
        selectedL2 = node;
        selectedL3 = null;
        showMappedL3 = false;
        showUnmappedL3 = false;
        selectedProject = node.projects[0] || null;
        filterEl.disabled = false;
        filterEl.value = '';
        resultsTitleEl.textContent = node.label;
        definitionEl.textContent = node.definition || 'No ontology definition exported.';
        detailEl.innerHTML = selectedProject ? renderDetail(selectedProject, baseUrl) : '<p class="empty-state">No projects are currently annotated to this treatment class.</p>';
        history.replaceState(null, '', `#${encodeURIComponent(node.curie)}`);
        renderL2();
        renderL3();
        renderProjects();
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
        showMappedL3 = false;
        showUnmappedL3 = false;
        selectedProject = null;
        filterEl.disabled = true;
        resultsTitleEl.textContent = 'Select a treatment class';
        definitionEl.textContent = 'Select a Level 2 class to see all studies, then optionally refine them with Level 3.';
        resultsCountEl.textContent = '';
        projectListEl.innerHTML = '';
        detailEl.innerHTML = '<p class="detail-kicker">Project metadata</p><h3>Select a study</h3><p class="row-meta">Choose a Level 2 treatment class first.</p>';
        renderL1();
        renderL2();
        renderL3();
      }));
    };

    filterEl.addEventListener('input', renderProjects);
    const requestedCurie = decodeURIComponent(window.location.hash.slice(1));
    const requestedL1 = l1Nodes.find((node) => node.children.some((child) => child.curie === requestedCurie || child.children?.some((grandchild) => grandchild.curie === requestedCurie)));
    if (requestedL1) selectedL1 = requestedL1;
    renderL1();
    renderL2();
    renderL3();
    const requestedL2 = selectedL1.children.find((child) => child.curie === requestedCurie || child.children?.some((grandchild) => grandchild.curie === requestedCurie));
    if (requestedL2) l2El.querySelector<HTMLButtonElement>(`[data-curie="${requestedL2.curie}"]`)?.click();
    const requestedL3 = requestedL2?.children?.find((child) => child.curie === requestedCurie);
    if (requestedL3) l3El.querySelectorAll<HTMLButtonElement>('[data-l3-curie]').forEach((button) => {
      if (button.dataset.l3Curie === requestedL3.curie) button.click();
    });
  } catch {
    totalEl.textContent = 'Treatment data could not be loaded.';
    l1El.innerHTML = '<p class="empty-state">Rebuild the public export to create treatment_browser.json.</p>';
  }
}