// Pure functions turning raw OME responses into the console's per-input status model.

const ACTIVE_RECORD_STATES = new Set(['recording', 'stopping', 'ready_to_record']);

function findTrack(info, type) {
  const track = (info?.input?.tracks ?? []).find((t) => t.type === type);
  return track ? track[type.toLowerCase()] : null;
}

export function summarizeVideo(video) {
  if (!video) return null;
  return {
    codec: video.codec,
    width: video.width,
    height: video.height,
    fps: Math.round((video.framerateLatest ?? video.framerate ?? 0) * 100) / 100,
    bitrateBps: video.bitrateLatest ?? video.bitrate ?? 0,
    keyFrameInterval: video.keyFrameIntervalLatest ?? video.keyFrameInterval ?? null,
  };
}

export function summarizeAudio(audio) {
  if (!audio) return null;
  return {
    codec: audio.codec,
    channels: audio.channel,
    sampleRate: audio.samplerate,
    bitrateBps: audio.bitrateLatest ?? audio.bitrate ?? 0,
  };
}

// The console writes {"take": n, ...} into OME's per-recording metadata string.
function takeFromMetadata(raw) {
  try {
    const take = JSON.parse(raw ?? '')?.take;
    return Number.isInteger(take) ? take : null;
  } catch {
    return null;
  }
}

// Recording state for one stream from OME's :records list.
export function activeRecordFor(records, streamName) {
  const rec = (records ?? []).find(
    (r) => r?.stream?.name === streamName && ACTIVE_RECORD_STATES.has(r.state),
  );
  if (!rec) return null;
  return {
    take: takeFromMetadata(rec.metadata),
    id: rec.id,
    state: rec.state,
    startTime: rec.startTime ?? rec.createdTime ?? null,
    recordBytes: rec.recordBytes ?? 0,
    recordTimeMs: rec.recordTime ?? 0,
    outputFilePath: rec.outputFilePath ?? null,
  };
}

// signal: "live" (receiving), "stalled" (stream exists but no data recently), "none".
export function summarizeInput(input, { info, stats, records, now = Date.now(), staleAfterMs = 5000 }) {
  const base = { name: input.name, port: input.port, recording: activeRecordFor(records, input.name) };
  if (!info) return { ...base, signal: 'none', video: null, audio: null, connectedSince: null, lastRecv: null, bitrateBps: 0 };

  const lastRecv = stats?.lastRecvTime ?? null;
  const lastRecvMs = lastRecv ? Date.parse(lastRecv) : NaN;
  const stalled = Number.isFinite(lastRecvMs) && now - lastRecvMs > staleAfterMs;

  const video = summarizeVideo(findTrack(info, 'Video'));
  const audio = summarizeAudio(findTrack(info, 'Audio'));
  // Total media bitrate from OME's per-track measurements (bits/s). OME's stats
  // lastThroughputIn is bytes/s and is deliberately not used for display.
  return {
    ...base,
    signal: stalled ? 'stalled' : 'live',
    video,
    audio,
    connectedSince: info.input?.createdTime ?? null,
    lastRecv,
    bitrateBps: (video?.bitrateBps ?? 0) + (audio?.bitrateBps ?? 0),
  };
}

export function newRecordId(streamName, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${streamName}-${stamp}`;
}
