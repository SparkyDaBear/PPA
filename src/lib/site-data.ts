import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const EXPORT_DIR = path.resolve('export');
const PXD_DIR = path.join(EXPORT_DIR, 'pxd');

let validProjectsCache: Promise<Array<any>> | null = null;
let curieCountCache: Promise<Map<string, number>> | null = null;

async function readJson(filePath: string) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as any;
}

export async function getRelease() {
  return readJson(path.join(EXPORT_DIR, 'release.json'));
}

export async function getOntology() {
  const [ontology, curieCounts] = await Promise.all([
    readJson(path.join(EXPORT_DIR, 'ontology.json')),
    getCurieProjectCounts(),
  ]);

  const nodes = (ontology.nodes || []).map((node: any) => ({
    ...node,
    linked_pxd_count: curieCounts.get(node.curie) || 0,
  }));

  return {
    ...ontology,
    nodes,
  };
}

export async function getTreatmentFocusedOntologyTree() {
  const [ontology, projects] = await Promise.all([getOntology(), getValidProjectRecords()]);
  const nodes = (ontology.nodes || []) as Array<any>;
  const byCurie = new Map(nodes.map((node) => [node.curie, node]));

  const treatmentRootCurie = 'PPA:0000002';
  const biologicalVarCurie = 'PPA:0000008';

  const treatmentRoot = byCurie.get(treatmentRootCurie);
  const biologicalVar = byCurie.get(biologicalVarCurie);
  if (!treatmentRoot || !biologicalVar) {
    return {
      root_curie: treatmentRootCurie,
      nodes,
      branches: {},
    };
  }

  const treatmentL1Curies = (biologicalVar.children || []).filter((curie: string) => byCurie.has(curie));
  const treatmentL2Curies = new Set<string>();
  for (const l1Curie of treatmentL1Curies) {
    const l1 = byCurie.get(l1Curie);
    for (const childCurie of l1?.children || []) {
      if (byCurie.has(childCurie)) {
        treatmentL2Curies.add(childCurie);
      }
    }
  }

  const allRootChildren = (byCurie.get('PPA:0000001')?.children || []).filter((curie: string) => byCurie.has(curie));
  const nonTreatmentBranchRoots = allRootChildren.filter((curie: string) => curie !== treatmentRootCurie);

  const treatmentAssignments = assignProjectsToTreatmentNodes(
    projects,
    byCurie,
    treatmentL1Curies,
    treatmentL2Curies,
  );

  const customByCurie = new Map<string, any>();

  // Add treatment root with direct L1 children (skip intermediate PPA:0000008 in navigation).
  customByCurie.set(
    treatmentRootCurie,
    withTreeMeta({
      ...treatmentRoot,
      children: [...treatmentL1Curies],
    }, []),
  );

  for (const l1Curie of treatmentL1Curies) {
    const l1 = byCurie.get(l1Curie);
    if (!l1) continue;

    const l1Projects = Array.from(treatmentAssignments.l1ToProjects.get(l1Curie) || []).sort();
    customByCurie.set(l1Curie, withTreeMeta({ ...l1 }, l1Projects));

    for (const l2Curie of l1.children || []) {
      const l2 = byCurie.get(l2Curie);
      if (!l2) continue;

      const l2Projects = Array.from(treatmentAssignments.l2ToProjects.get(l2Curie) || []).sort();
      const contextualChildren = nonTreatmentBranchRoots.map(
        (rootCurie) => `CTX:${l2Curie}::${rootCurie}`,
      );

      customByCurie.set(
        l2Curie,
        withTreeMeta(
          {
            ...l2,
            children: contextualChildren,
          },
          l2Projects,
        ),
      );

      for (const branchRootCurie of nonTreatmentBranchRoots) {
        cloneContextSubtree(
          branchRootCurie,
          l2Curie,
          l2Projects,
          byCurie,
          customByCurie,
        );
      }
    }
  }

  return {
    root_curie: treatmentRootCurie,
    nodes: Array.from(customByCurie.values()),
    branches: { treatment: { root: treatmentRootCurie } },
  };
}

export async function getTermIndex() {
  const [terms, curieCounts] = await Promise.all([
    readJson(path.join(EXPORT_DIR, 'term_index.json')),
    getCurieProjectCounts(),
  ]);

  return ((terms || []) as Array<any>).map((term) => ({
    ...term,
    linked_pxd_count: curieCounts.get(term.curie) || 0,
  }));
}

export async function getProjectIndex() {
  return {
    projects: await getValidProjectRecords(),
  };
}

export async function getProject(pxd: string) {
  const projects = await getValidProjectRecords();
  const project = projects.find((item) => item?.pxd === pxd);
  if (!project) {
    throw new Error(`Project not found or invalid schema: ${pxd}`);
  }
  return project;
}

export function projectMentionsCurie(project: any, curie: string): boolean {
  return collectProjectCuries(project).has(curie);
}

function withTreeMeta(node: any, projectIds: Array<string>) {
  return {
    ...node,
    linked_pxd_count: projectIds.length,
    project_ids: projectIds,
    term_page_available: /^PPA:\d+$/.test(String(node.curie || '')),
    source_curie: node.curie,
  };
}

function cloneContextSubtree(
  sourceCurie: string,
  l2Curie: string,
  l2Projects: Array<string>,
  byCurie: Map<string, any>,
  out: Map<string, any>,
): string {
  const source = byCurie.get(sourceCurie);
  const ctxCurie = `CTX:${l2Curie}::${sourceCurie}`;
  if (!source) {
    out.set(
      ctxCurie,
      withTreeMeta(
        {
          curie: ctxCurie,
          preferred_label: `Missing node ${sourceCurie}`,
          definition: 'Source ontology node is missing.',
          branch: null,
          parent: null,
          children: [],
          source_curie: sourceCurie,
        },
        [],
      ),
    );
    return ctxCurie;
  }

  const childCtxCuries = (source.children || []).map((childCurie: string) =>
    cloneContextSubtree(childCurie, l2Curie, l2Projects, byCurie, out),
  );

  const memberProjects =
    sourceCurie === 'PPA:0000003' ||
    sourceCurie === 'PPA:0000004' ||
    sourceCurie === 'PPA:0000005' ||
    sourceCurie === 'PPA:0000006' ||
    sourceCurie === 'PPA:0000007'
      ? l2Projects
      : l2Projects.filter((pxd) => {
          const project = projectByPxdCache.get(pxd);
          return project ? projectMentionsCurie(project, sourceCurie) : false;
        });

  out.set(
    ctxCurie,
    withTreeMeta(
      {
        ...source,
        curie: ctxCurie,
        source_curie: sourceCurie,
        parent: `CTX:${l2Curie}::${source.parent}`,
        children: childCtxCuries,
      },
      memberProjects,
    ),
  );

  return ctxCurie;
}

let projectByPxdCache = new Map<string, any>();

function assignProjectsToTreatmentNodes(
  projects: Array<any>,
  byCurie: Map<string, any>,
  l1Curies: Array<string>,
  l2Curies: Set<string>,
) {
  projectByPxdCache = new Map(projects.map((project) => [project.pxd, project]));

  const l1ToProjects = new Map<string, Set<string>>();
  const l2ToProjects = new Map<string, Set<string>>();

  const l2ToParent = new Map<string, string>();
  for (const l1Curie of l1Curies) {
    const l1 = byCurie.get(l1Curie);
    for (const childCurie of l1?.children || []) {
      l2ToParent.set(childCurie, l1Curie);
    }
  }

  for (const project of projects) {
    const pxd = project?.pxd;
    if (typeof pxd !== 'string') continue;

    const variables = project?.treatment?.primary_variables || [];
    for (const variable of variables) {
      const l1Curie = resolveTreatmentL1Curie(variable, byCurie, l1Curies);
      const l2Curie = resolveTreatmentL2Curie(variable, byCurie, l2Curies, l1Curie);

      if (l1Curie) {
        if (!l1ToProjects.has(l1Curie)) l1ToProjects.set(l1Curie, new Set());
        l1ToProjects.get(l1Curie)?.add(pxd);
      }

      if (l2Curie) {
        if (!l2ToProjects.has(l2Curie)) l2ToProjects.set(l2Curie, new Set());
        l2ToProjects.get(l2Curie)?.add(pxd);

        const parent = l2ToParent.get(l2Curie);
        if (parent) {
          if (!l1ToProjects.has(parent)) l1ToProjects.set(parent, new Set());
          l1ToProjects.get(parent)?.add(pxd);
        }
      }
    }
  }

  return {
    l1ToProjects,
    l2ToProjects,
  };
}

function resolveTreatmentL1Curie(variable: any, byCurie: Map<string, any>, l1Curies: Array<string>) {
  const asCurie = firstTreatmentCurieCandidate(variable, byCurie);
  if (asCurie && l1Curies.includes(asCurie)) {
    return asCurie;
  }

  if (asCurie) {
    const parent = byCurie.get(asCurie)?.parent;
    if (typeof parent === 'string' && l1Curies.includes(parent)) {
      return parent;
    }
  }

  const parentKey = variable?.matched_parent_class_key;
  const matchedFromParent = matchTreatmentNodeByKey(parentKey, l1Curies, byCurie);
  if (matchedFromParent) return matchedFromParent;

  return null;
}

function resolveTreatmentL2Curie(
  variable: any,
  byCurie: Map<string, any>,
  l2Curies: Set<string>,
  l1Curie: string | null,
) {
  const asCurie = firstTreatmentCurieCandidate(variable, byCurie);
  if (asCurie && l2Curies.has(asCurie)) {
    return asCurie;
  }

  const classKey = variable?.matched_class_key;
  const l1Children =
    l1Curie && byCurie.get(l1Curie)
      ? ((byCurie.get(l1Curie)?.children || []).filter((curie: string) => l2Curies.has(curie)) as Array<string>)
      : undefined;

  return matchTreatmentNodeByKey(classKey, l1Children, byCurie);
}

function firstTreatmentCurieCandidate(variable: any, byCurie: Map<string, any>) {
  const candidates = [
    variable?.ontology_curie,
    variable?.matched_class_key,
    variable?.matched_parent_class_key,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && /^PPA:\d+$/.test(value) && byCurie.has(value)) {
      return value;
    }
  }

  return null;
}

function matchTreatmentNodeByKey(
  key: unknown,
  candidateCuries: Array<string> | Set<string> | undefined,
  byCurie: Map<string, any>,
) {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return null;
  }

  const normalizedKey = normalizeForMatch(key);
  if (!normalizedKey) return null;

  const candidateList = candidateCuries
    ? Array.from(candidateCuries)
    : Array.from(byCurie.values())
        .filter((node: any) => node?.branch === 'treatment')
        .map((node: any) => node.curie);

  let best: { curie: string; score: number } | null = null;
  for (const curie of candidateList) {
    const node = byCurie.get(curie);
    if (!node) continue;

    const score = scoreNodeMatch(normalizedKey, node);
    if (!best || score > best.score) {
      best = { curie, score };
    }
  }

  if (!best || best.score < 0.35) {
    return null;
  }

  return best.curie;
}

function scoreNodeMatch(normalizedKey: string, node: any) {
  const fields = [
    node.preferred_label,
    ...(node.synonyms || []),
    ...(node.current_field_mapping || []),
  ]
    .filter((value) => typeof value === 'string')
    .map((value) => normalizeForMatch(value));

  let best = 0;
  const keyTokens = normalizedKey.split(' ').filter(Boolean);
  for (const field of fields) {
    if (!field) continue;
    if (field.includes(normalizedKey) || normalizedKey.includes(field)) {
      best = Math.max(best, 1);
      continue;
    }

    const fieldTokens = field.split(' ').filter(Boolean);
    const overlap = keyTokens.filter((token) => fieldTokens.includes(token)).length;
    const ratio = overlap / Math.max(keyTokens.length, 1);
    best = Math.max(best, ratio);
  }

  return best;
}

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/ppa:\d+/g, ' ')
    .replace(/[_:()\-]/g, ' ')
    .replace(/\btreatment\b/g, ' ')
    .replace(/\bcomparison\b/g, ' ')
    .replace(/\bmetadata\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getValidProjectRecords() {
  if (!validProjectsCache) {
    validProjectsCache = (async () => {
      const entries = await readdir(PXD_DIR, { withFileTypes: true });
      const projectFiles = entries
        .filter((entry) => entry.isFile() && /^PXD\d+\.json$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();

      const loadedProjects = await Promise.all(
        projectFiles.map(async (fileName) => {
          try {
            const payload = await readJson(path.join(PXD_DIR, fileName));
            return isValidProjectSchema(payload) ? payload : null;
          } catch {
            return null;
          }
        }),
      );

      return loadedProjects
        .filter((item): item is any => Boolean(item))
        .sort((a, b) => String(a.pxd).localeCompare(String(b.pxd)));
    })();
  }

  return validProjectsCache;
}

async function getCurieProjectCounts() {
  if (!curieCountCache) {
    curieCountCache = (async () => {
      const projects = await getValidProjectRecords();
      const counts = new Map<string, number>();

      for (const project of projects) {
        const curies = collectProjectCuries(project);
        for (const curie of curies) {
          counts.set(curie, (counts.get(curie) || 0) + 1);
        }
      }

      return counts;
    })();
  }

  return curieCountCache;
}

function collectProjectCuries(project: any): Set<string> {
  const curies = new Set<string>();

  const treatmentVars = project?.treatment?.primary_variables || [];
  for (const item of treatmentVars) {
    const curie = item?.ontology_curie;
    if (typeof curie === 'string' && curie.length > 0) {
      curies.add(curie);
    }
  }

  const assayTargets = project?.assay?.targets_and_enrichments || [];
  for (const item of assayTargets) {
    const curie = item?.ontology_curie;
    if (typeof curie === 'string' && curie.length > 0) {
      curies.add(curie);
    }
  }

  const sampleScopeCurie = project?.sample_source?.sample_scope?.curie;
  if (typeof sampleScopeCurie === 'string' && sampleScopeCurie.length > 0) {
    curies.add(sampleScopeCurie);
  }

  return curies;
}

function isValidProjectSchema(project: any): boolean {
  if (!project || typeof project !== 'object') {
    return false;
  }

  if (typeof project.pxd !== 'string' || !/^PXD\d+$/.test(project.pxd)) {
    return false;
  }

  const requiredObjectKeys = [
    'summary',
    'treatment',
    'experimental_design',
    'sample_source',
    'assay',
    'processing',
    'stage4',
    'source_links',
    'provenance',
  ];

  for (const key of requiredObjectKeys) {
    if (!project[key] || typeof project[key] !== 'object') {
      return false;
    }
  }

  return true;
}

export function normalizeLabel(value?: string | null) {
  return value ? value.replace(/_/g, ' ') : 'Unassigned';
}

export function titleize(value?: string | null) {
  if (!value) return 'Unknown';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function stringifyList(values: Array<string | null | undefined> | undefined) {
  return (values || []).filter(Boolean).join(', ') || 'None';
}