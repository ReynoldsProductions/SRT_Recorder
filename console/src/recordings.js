// Lists finished/in-progress recording files from OME's FILE publisher output dir.
// Layout: <dir>/<TransactionId>/<start>_<end>.ts with a sidecar .xml.

import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const TAG = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([^<\\]]*)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1] : null;
};

function parseMetadata(raw) {
  if (!raw) return {};
  try {
    const m = JSON.parse(raw);
    return {
      clip: typeof m.clip === 'string' ? m.clip : null,
      shoot: typeof m.shoot === 'string' ? m.shoot : null,
      input: typeof m.input === 'string' ? m.input : null,
      take: Number.isInteger(m.take) ? m.take : null,
    };
  } catch {
    return {};
  }
}

export function parseInfoXml(xml) {
  return {
    ...parseMetadata(TAG(xml, 'metadata')),
    id: TAG(xml, 'id'),
    stream: TAG(xml, 'stream'),
    startTime: TAG(xml, 'startTime'),
    finishTime: TAG(xml, 'finishTime'),
    recordTimeMs: Number(TAG(xml, 'recordTime')) || null,
  };
}

async function safeReadInfo(path) {
  try {
    return parseInfoXml(await readFile(path, 'utf8'));
  } catch {
    return {};
  }
}

// Walks up to MAX_DEPTH directory levels (layouts: <tx>/<file>.ts and <shoot>/<input>/<file>.ts).
const MAX_DEPTH = 3;

async function collectTs(root, rel, depth, out) {
  const entries = await readdir(join(root, rel), { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && depth < MAX_DEPTH) await collectTs(root, childRel, depth + 1, out);
    else if (e.isFile() && e.name.endsWith('.ts') && depth > 0 && !e.name.startsWith('tmp_')) out.push(childRel);
  }
  return out;
}

export async function listRecordings(dir, { limit = 200 } = {}) {
  try {
    await readdir(dir);
  } catch (err) {
    throw new Error(`cannot read recordings dir ${dir}: ${err.code ?? err.message}`);
  }
  const paths = await collectTs(dir, '', 0, []);
  const files = await Promise.all(
    paths.map(async (rel) => {
      const st = await stat(join(dir, rel)).catch(() => null);
      if (!st) return null;
      const info = await safeReadInfo(join(dir, rel.replace(/\.ts$/, '.xml')));
      return { path: rel, sizeBytes: st.size, modified: st.mtime.toISOString(), ...info };
    }),
  );
  return files.filter(Boolean).sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, limit);
}
