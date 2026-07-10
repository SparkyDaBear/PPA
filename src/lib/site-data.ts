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