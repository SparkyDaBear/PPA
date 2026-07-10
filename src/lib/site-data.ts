import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXPORT_DIR = path.resolve('export');

async function readJson(filePath: string) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as any;
}

export async function getRelease() {
  return readJson(path.join(EXPORT_DIR, 'release.json'));
}

export async function getOntology() {
  return readJson(path.join(EXPORT_DIR, 'ontology.json'));
}

export async function getTermIndex() {
  return (await readJson(path.join(EXPORT_DIR, 'term_index.json'))) as Array<any>;
}

export async function getProjectIndex() {
  return (await readJson(path.join(EXPORT_DIR, 'pxd_index.json'))) as { projects: Array<any> };
}

export async function getProject(pxd: string) {
  return readJson(path.join(EXPORT_DIR, 'pxd', `${pxd}.json`));
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