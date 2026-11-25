// Human-chosen recording names -> safe OME file paths.
// Result: <shoot>/<input>/<clip>_T<take>_<YYYY-MM-DD_HH-MM-SS>.ts (local time of the console's TZ).

const MAX_LEN = 48;

// Keeps letters, digits, '-', '_'; spaces become '-'. Never emits '$', '/', '.', so the
// result can't inject OME path tokens or escape the recordings directory.
export function sanitizeName(raw) {
  return String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, MAX_LEN);
}

const pad = (n) => String(n).padStart(2, '0');

export function localStamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

export const formatTake = (take) => `T${String(take).padStart(3, '0')}`;

// Key for the per shoot/camera/clip take counter.
export const takeKey = ({ shoot, input, clip }) =>
  `${sanitizeName(shoot) || 'unsorted'}/${input}/${sanitizeName(clip) || 'untitled'}`;

export function buildRecordingPaths({ shoot, clip, input, take = 1, now = new Date() }) {
  const shootDir = sanitizeName(shoot) || 'unsorted';
  const clipName = sanitizeName(clip) || 'untitled';
  const base = `${clipName}_${formatTake(take)}_${localStamp(now)}`;
  return Object.freeze({
    shoot: shootDir,
    clip: clipName,
    take,
    filePath: `${shootDir}/${input}/${base}.ts`,
    infoPath: `${shootDir}/${input}/${base}.xml`,
  });
}

// Next file name without the timestamp (which is only known at start), for display.
export function previewFileName({ shoot, clip, input, take }) {
  const shootDir = sanitizeName(shoot) || 'unsorted';
  return `${shootDir}/${input}/${sanitizeName(clip) || 'untitled'}_${formatTake(take)}_<time>.ts`;
}
