import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const EXPORT_DIR = path.resolve('export');
const PXD_DIR = path.join(EXPORT_DIR, 'pxd');

let validProjectsCache: Promise<Array<any>> | null = null;
let termProjectsCache: Promise<Map<string, Array<string>>> | null = null;
let pxdL3IndexCache: Promise<Record<string, Array<L3Membership>>> | null = null;

export type L3Membership = {
  branch: string;
  l1_label: string;
  l2_curie: string;
  l2_label: string;
  membership_type: 'l3' | 'unresolved' | 'no_l3_value' | 'l1_only';
  l3_label: string;
  l3_id: string;
};

async function readJson(filePath: string) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as any;
}

export async function getRelease() {
  return readJson(path.join(EXPORT_DIR, 'release.json'));
}

export async function getOntology() {
  const [ontology, termProjects] = await Promise.all([
    readJson(path.join(EXPORT_DIR, 'ontology.json')),
    getTermProjects(),
  ]);

  const nodes = (ontology.nodes || []).map((node: any) => ({
    ...node,
    linked_pxd_count: termProjects.get(node.curie)?.length || 0,
    project_ids: termProjects.get(node.curie) || [],
  }));

  return {
    ...ontology,
    nodes,
  };
}

export async function getTermIndex() {
  const [terms, termProjects] = await Promise.all([
    readJson(path.join(EXPORT_DIR, 'term_index.json')),
    getTermProjects(),
  ]);

  return ((terms || []) as Array<any>).map((term) => ({
    ...term,
    linked_pxd_count: termProjects.get(term.curie)?.length || 0,
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

export async function getTermProjects() {
  if (!termProjectsCache) {
    termProjectsCache = (async () => {
      const payload = await readJson(path.join(EXPORT_DIR, 'term_projects.json'));
      return new Map(
        (payload.terms || [])
          .filter((item: any) => typeof item?.curie === 'string' && Array.isArray(item?.pxd_ids))
          .map((item: any) => [item.curie, item.pxd_ids]),
      );
    })();
  }

  return termProjectsCache;
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

  return Boolean(project.assay.biological_source && typeof project.assay.biological_source === 'object');
}

export async function getProjectL3Memberships(pxd: string): Promise<Array<L3Membership>> {
  if (!pxdL3IndexCache) {
    pxdL3IndexCache = readJson(path.join(EXPORT_DIR, 'l3', 'pxd_l3_index.json')).catch(() => ({}));
  }
  return (await pxdL3IndexCache)[pxd] || [];
}

export function itemLabels(items: unknown): Array<string> {
  if (!Array.isArray(items)) return [];
  return [...new Set(items
    .map((item) => (item && typeof item === 'object' ? (item as any).label : item))
    .filter((label): label is string => typeof label === 'string' && label.trim().length > 0))];
}

export function sampleScopeCategories(project: any): Array<string> {
  return [...new Set(((project?.assay?.sample_scopes || []) as Array<any>)
    .map((entry) => entry?.category)
    .filter((category): category is string => typeof category === 'string' && category.length > 0))];
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