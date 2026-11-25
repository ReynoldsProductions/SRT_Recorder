import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listRecordings, parseInfoXml } from '../src/recordings.js';

const XML = `<?xml version="1.0"?><files><file><id>fx2-live-01</id><stream>cam1</stream>
<filePath><![CDATA[tx/a.ts]]></filePath><recordTime>64097</recordTime>
<startTime>2026-11-25T00:47:48.063+00:00</startTime><finishTime>2026-11-25T00:48:52.182+00:00</finishTime></file></files>`;

test('parseInfoXml extracts OME sidecar fields', () => {
  assert.deepEqual(parseInfoXml(XML), { id: 'fx2-live-01', stream: 'cam1', startTime: '2026-11-25T00:47:48.063+00:00', finishTime: '2026-11-25T00:48:52.182+00:00', recordTimeMs: 64097 });
});

test('listRecordings walks transaction dirs, newest first, tolerates missing sidecars', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'c2c-rec-'));
  try {
    await mkdir(join(dir, 'tx1'));
    await mkdir(join(dir, 'tx2'));
    await writeFile(join(dir, 'tx1', 'a.ts'), 'xx');
    await writeFile(join(dir, 'tx1', 'a.xml'), XML);
    await writeFile(join(dir, 'tx2', 'b.ts'), 'yyyy');
    await writeFile(join(dir, 'stray.ts'), 'ignored: not in a transaction dir');
    await mkdir(join(dir, 'Shoot', 'cam1'), { recursive: true });
    await writeFile(join(dir, 'Shoot', 'cam1', 'clip_T001.ts'), 'zzz');
    await writeFile(join(dir, 'Shoot', 'cam1', 'tmp_partial.ts'), 'ignored temp');
    await utimes(join(dir, 'Shoot', 'cam1', 'clip_T001.ts'), new Date('2025-01-01'), new Date('2025-01-01'));
    await utimes(join(dir, 'tx1', 'a.ts'), new Date('2026-01-01'), new Date('2026-01-01'));
    const recs = await listRecordings(dir);
    assert.equal(recs.length, 3);
    assert.equal(recs[2].path, 'Shoot/cam1/clip_T001.ts');
    assert.equal(recs[0].path, 'tx2/b.ts');
    assert.equal(recs[0].sizeBytes, 4);
    assert.equal(recs[0].id, undefined);
    assert.equal(recs[1].id, 'fx2-live-01');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listRecordings errors clearly on unreadable dir', async () => {
  await assert.rejects(listRecordings('/nonexistent-c2c'), /cannot read recordings dir/);
});

test('parseInfoXml reads clip/shoot from JSON metadata and ignores junk', () => {
  const withMeta = XML.replace('<id>', '<metadata>{"shoot":"Day1","clip":"interview-a","input":"cam1","take":3}</metadata><id>');
  assert.equal(parseInfoXml(withMeta).take, 3);
  assert.equal(parseInfoXml(withMeta).input, 'cam1');
  assert.equal(parseInfoXml(withMeta).clip, 'interview-a');
  assert.equal(parseInfoXml(withMeta).shoot, 'Day1');
  assert.equal(parseInfoXml(XML.replace('<id>', '<metadata>clip=x</metadata><id>')).clip, undefined);
});
