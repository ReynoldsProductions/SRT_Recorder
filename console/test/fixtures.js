// Fixtures shaped like real OME v0.21.0 responses captured from the FX2 on 2026-11-24.
export const streamInfo = {
  input: {
    createdTime: '2026-11-25T00:47:28.509+00:00',
    sourceType: 'SRT',
    tracks: [
      { id: 2, name: 'Data', type: 'Data', data: { codec: 'None' } },
      { id: 256, name: 'Video', type: 'Video', video: { codec: 'H264', width: 3840, height: 2160, framerate: 29.970029830932617, framerateLatest: 30.0, bitrate: 18523796, bitrateLatest: 21507088, keyFrameInterval: 60, keyFrameIntervalLatest: 60 } },
      { id: 257, name: 'Audio', type: 'Audio', audio: { codec: 'AAC', channel: 2, samplerate: 48000, bitrate: 130763, bitrateLatest: 129307 } },
    ],
  },
  name: 'cam1',
};
export const streamStats = (lastRecvTime) => ({ createdTime: '2026-11-25T00:47:28.509+00:00', lastRecvTime, lastThroughputIn: 21620011, totalBytesIn: 751817795 });
export const recordingRecord = { id: 'cam1-20261125T004747Z', state: 'recording', startTime: '2026-11-25T00:47:48.063+00:00', recordBytes: 1000, recordTime: 5000, outputFilePath: 'x/y.ts', stream: { name: 'cam1' } };
