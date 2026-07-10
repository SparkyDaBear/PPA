import * as d3 from 'd3';

type OntologyNode = {
  curie: string;
  source_curie?: string;
  preferred_label: string;
  definition?: string;
  branch?: string | null;
  parent?: string | null;
  children?: string[];
  linked_pxd_count?: number;
  project_ids?: string[];
  term_page_available?: boolean;
};

type BranchMap = Record<string, { root?: string; description?: string }>;

type TreeNode = {
  id: string;
  curie: string;
  source_curie: string;
  preferred_label: string;
  definition: string;
  branch: string | null;
  linked_pxd_count: number;
  project_ids: string[];
  term_page_available: boolean;
  child_count: number;
  children?: TreeNode[];
  _children?: TreeNode[];
};

type TreePayload = {
  nodes: OntologyNode[];
  branches: BranchMap;
  root_curie?: string;
};

type InitOptions = {
  svgId: string;
  dataId: string;
  containerId: string;
  detailPrefix: string;
};

type HierNode = d3.HierarchyPointNode<TreeNode> & {
  _children?: HierNode[];
  x0?: number;
  y0?: number;
};

function titleize(value: string | null | undefined) {
  return value ? value.replace(/_/g, ' ') : 'Unassigned';
}

function collapseHierarchy(node: HierNode) {
  if (!node.children || node.children.length === 0) {
    return;
  }
  node._children = node.children as HierNode[];
  node._children.forEach(collapseHierarchy);
  node.children = null;
}

function toTreeNode(curie: string, byCurie: Map<string, OntologyNode>): TreeNode {
  const raw = byCurie.get(curie);
  if (!raw) {
    return {
      id: curie,
      curie,
      source_curie: curie,
      preferred_label: curie,
      definition: 'Missing ontology node in export payload.',
      branch: null,
      linked_pxd_count: 0,
      project_ids: [],
      term_page_available: false,
      child_count: 0,
      children: [],
    };
  }

  const childIds = (raw.children || []).filter((childCurie) => byCurie.has(childCurie));
  const children = childIds.map((childCurie) => toTreeNode(childCurie, byCurie));

  return {
    id: raw.curie,
    curie: raw.curie,
    source_curie: raw.source_curie || raw.curie,
    preferred_label: raw.preferred_label,
    definition: raw.definition || 'No definition available.',
    branch: raw.branch ?? null,
    linked_pxd_count: raw.linked_pxd_count || 0,
    project_ids: raw.project_ids || [],
    term_page_available: Boolean(raw.term_page_available),
    child_count: childIds.length,
    children,
  };
}

function getTextElement(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function initOntologyTree(options: InitOptions) {
  const dataEl = document.getElementById(options.dataId);
  const container = document.getElementById(options.containerId);
  const svgEl = document.getElementById(options.svgId) as SVGElement | null;

  if (!dataEl || !container || !svgEl) {
    return;
  }

  const payload = JSON.parse(dataEl.textContent || '{}') as TreePayload;
  const nodeList = payload.nodes || [];
  if (nodeList.length === 0) {
    return;
  }

  const byCurie = new Map(nodeList.map((node) => [node.curie, node]));

  const rootCurie = payload.root_curie && byCurie.has(payload.root_curie)
    ? payload.root_curie
    : null;

  const branchRoots = Object.values(payload.branches || {})
    .map((entry) => entry.root)
    .filter((root): root is string => Boolean(root) && byCurie.has(root));

  const syntheticRoot: TreeNode = rootCurie
    ? toTreeNode(rootCurie, byCurie)
    : {
        id: 'PPA_TREE_ROOT',
        curie: 'PPA:0000001',
        source_curie: 'PPA:0000001',
        preferred_label: 'PPA metadata ontology',
        definition: 'Synthetic tree root used for branch-first rendering.',
        branch: null,
        linked_pxd_count: 0,
        project_ids: [],
        term_page_available: false,
        child_count: branchRoots.length,
        children: branchRoots.map((rootCurie) => toTreeNode(rootCurie, byCurie)),
      };

  const width = Math.max(container.clientWidth, 760);
  const height = Math.max(window.innerHeight * 0.72, 620);

  const svg = d3
    .select(svgEl)
    .attr('viewBox', [0, 0, width, height].join(' '))
    .attr('preserveAspectRatio', 'xMidYMid meet');

  svg.selectAll('*').remove();

  const canvas = svg.append('g').attr('class', 'tree-canvas').attr('transform', 'translate(80,40)');

  svg.call(
    d3
      .zoom<SVGElement, unknown>()
      .scaleExtent([0.5, 3])
      .on('zoom', (event) => {
        canvas.attr('transform', event.transform.toString());
      }),
  );

  const root = d3.hierarchy<TreeNode>(syntheticRoot);
  const treeRoot = root as HierNode;
  treeRoot.x0 = height / 2;
  treeRoot.y0 = 0;

  const tree = d3.tree<TreeNode>().nodeSize([34, 240]);
  const duration = 240;

  const base = container.dataset.base || '/';

  const titleEl = getTextElement(`${options.detailPrefix}-title`);
  const curieEl = getTextElement(`${options.detailPrefix}-curie`);
  const branchEl = getTextElement(`${options.detailPrefix}-branch`);
  const defEl = getTextElement(`${options.detailPrefix}-def`);
  const statsEl = getTextElement(`${options.detailPrefix}-stats`);
  const projectsEl = getTextElement(`${options.detailPrefix}-projects`);
  const linkWrapEl = getTextElement(`${options.detailPrefix}-link-wrap`);

  const setDetail = (datum: TreeNode) => {
    if (titleEl) titleEl.textContent = datum.preferred_label;
    if (curieEl) curieEl.textContent = datum.curie;
    if (branchEl) branchEl.textContent = `Branch: ${titleize(datum.branch)}`;
    if (defEl) defEl.textContent = datum.definition;
    if (statsEl) {
      statsEl.textContent = `${datum.child_count} child terms · ${datum.linked_pxd_count} linked projects`;
    }
    if (projectsEl) {
      if (!datum.project_ids || datum.project_ids.length === 0) {
        projectsEl.textContent = 'PXDs: none linked for this node context.';
      } else {
        const first = datum.project_ids.slice(0, 12);
        const links = first
          .map((pxd) => `<a class="badge" href="${base}projects/${encodeURIComponent(pxd)}/">${pxd}</a>`)
          .join(' ');
        const remainder = datum.project_ids.length - first.length;
        projectsEl.innerHTML = remainder > 0 ? `${links} <span class="row-code">+${remainder} more</span>` : links;
      }
    }
    if (linkWrapEl) {
      if (datum.term_page_available && /^PPA:\d+$/.test(datum.source_curie || '')) {
        const href = `${base}terms/${encodeURIComponent(datum.source_curie)}/`;
        linkWrapEl.innerHTML = `<a class="badge" href="${href}">Open term page</a>`;
      } else {
        linkWrapEl.innerHTML = '';
      }
    }
  };

  const diagonal = d3
    .linkHorizontal<d3.HierarchyPointLink<TreeNode>, d3.HierarchyPointNode<TreeNode>>()
    .x((d) => d.y)
    .y((d) => d.x);

  function update(source: HierNode) {
    tree(treeRoot);

    const nodes = treeRoot.descendants() as HierNode[];
    const links = treeRoot.links();

    const nodeSel = canvas
      .selectAll<SVGGElement, d3.HierarchyPointNode<TreeNode>>('g.tree-node')
      .data(nodes, (d: any) => d.data.id);

    const nodeEnter = nodeSel
      .enter()
      .append('g')
      .attr('class', 'tree-node')
      .attr('transform', `translate(${source.y0},${source.x0})`)
      .on('click', (_event, d) => {
        const node = d as HierNode;
        if (node.children) {
          node._children = node.children as HierNode[];
          node.children = null;
        } else {
          node.children = node._children || null;
          node._children = undefined;
        }

        setDetail(node.data);
        update(node);
      });

    nodeEnter
      .append('circle')
      .attr('r', 1e-6)
      .attr('class', (d) => ((d as HierNode)._children && (d as HierNode)._children?.length ? 'tree-node-dot is-collapsed' : 'tree-node-dot'));

    nodeEnter
      .append('text')
      .attr('dy', '0.35em')
      .attr('x', (d) => ((d.children || (d as HierNode)._children?.length) ? -11 : 11))
      .attr('text-anchor', (d) => ((d.children || (d as HierNode)._children?.length) ? 'end' : 'start'))
      .attr('class', 'tree-node-label')
      .text((d) => d.data.preferred_label);

    const nodeMerge = nodeEnter.merge(nodeSel as any);

    nodeMerge
      .transition()
      .duration(duration)
      .attr('transform', (d) => `translate(${d.y},${d.x})`);

    nodeMerge
      .select('circle')
      .transition()
      .duration(duration)
      .attr('r', 7)
      .attr('class', (d) => ((d as HierNode)._children && (d as HierNode)._children?.length ? 'tree-node-dot is-collapsed' : 'tree-node-dot'));

    const nodeExit = nodeSel
      .exit()
      .transition()
      .duration(duration)
      .attr('transform', `translate(${source.y},${source.x})`)
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    const linkSel = canvas
      .selectAll<SVGPathElement, d3.HierarchyPointLink<TreeNode>>('path.tree-link')
      .data(links, (d: any) => d.target.data.id);

    const linkEnter = linkSel
      .enter()
      .insert('path', 'g')
      .attr('class', 'tree-link')
      .attr('d', () => {
        const o = { x: source.x0, y: source.y0 };
        return diagonal({ source: o as any, target: o as any });
      });

    linkEnter
      .merge(linkSel as any)
      .transition()
      .duration(duration)
      .attr('d', (d) => diagonal(d as any));

    linkSel
      .exit()
      .transition()
      .duration(duration)
      .attr('d', () => {
        const o = { x: source.x, y: source.y };
        return diagonal({ source: o as any, target: o as any });
      })
      .remove();

    nodes.forEach((d) => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }

  for (const branchNode of treeRoot.children || []) {
    for (const child of branchNode.children || []) {
      collapseHierarchy(child as HierNode);
    }
  }

  setDetail(treeRoot.data);
  update(treeRoot);
}
