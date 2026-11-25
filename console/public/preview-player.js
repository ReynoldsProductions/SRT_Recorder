// LL-HLS confidence preview for one input, via the console's same-origin proxy.
// Safari plays HLS natively; other browsers use the vendored hls.js (window.Hls).

const RETRY_MS = 3000;

export function createPreview(video, input, { onStatus = () => {} } = {}) {
  const src = `/app/${encodeURIComponent(input)}/llhls.m3u8`;
  let hls = null;
  let retryTimer = null;
  let active = false;

  function teardown() {
    clearTimeout(retryTimer);
    if (hls) hls.destroy();
    hls = null;
    video.removeAttribute('src');
    video.load();
  }

  function scheduleRetry(reason) {
    onStatus(`reconnecting (${reason})`);
    teardown();
    if (active) retryTimer = setTimeout(start, RETRY_MS);
  }

  function start() {
    if (!active) return;
    onStatus('loading');
    const Hls = window.Hls;
    if (Hls?.isSupported()) {
      hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, enableWorker: true });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        onStatus('playing');
        video.play().catch(() => onStatus('click to play'));
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) scheduleRetry(data.details);
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.onerror = () => scheduleRetry('native playback error');
      video.play().then(() => onStatus('playing'), () => onStatus('click to play'));
    } else {
      onStatus('preview not supported in this browser');
    }
  }

  return {
    play() {
      if (active) return;
      active = true;
      start();
    },
    stop() {
      active = false;
      teardown();
      onStatus('off');
    },
    get active() {
      return active;
    },
  };
}
