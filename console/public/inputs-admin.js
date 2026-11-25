// Input management UI: add/edit/remove inputs, passphrase regenerate, and the per-card
// "Camera setup" panel showing exactly what to enter on the camera.

const $ = (sel, root = document) => root.querySelector(sel);

export function createInputsAdmin({ api, showBanner, onChange }) {
  let config = { inputs: [], portRange: [0, 0], suggestedPort: null, publicHost: '' };
  const byName = () => new Map(config.inputs.map((i) => [i.name, i]));

  async function refresh() {
    try {
      config = await api('/api/config/inputs');
    } catch (err) {
      showBanner(`Could not load input settings: ${err.message}`);
    }
    return config;
  }

  async function mutate(path, body, okMsg) {
    try {
      config = await api(path, { method: 'POST', body });
      showBanner(null);
      if (okMsg) showBanner(okMsg, 'info');
      await onChange();
      return true;
    } catch (err) {
      showBanner(err.message);
      return false;
    }
  }

  // ---- dialog ----
  const dialog = $('#input-dialog');
  const form = $('#input-form');
  let editing = null;

  function openDialog(input) {
    editing = input?.name ?? null;
    $('#input-dialog-title').textContent = editing ? `Edit ${editing}` : 'Add input';
    form.name.value = input?.name ?? '';
    form.name.readOnly = Boolean(editing);
    form.label.value = input?.label ?? '';
    form.port.value = input?.port ?? config.suggestedPort ?? '';
    form.port.min = config.portRange[0];
    form.port.max = config.portRange[1];
    form.latencyMs.value = input?.latencyMs ?? 1000;
    form.enabled.checked = input?.enabled ?? true;
    $('#port-range').textContent = `(${config.portRange[0]}–${config.portRange[1]})`;
    dialog.showModal();
  }

  $('#input-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      label: form.label.value,
      port: Number(form.port.value),
      latencyMs: Number(form.latencyMs.value),
      enabled: form.enabled.checked,
    };
    const saved = editing
      ? await mutate(`/api/config/inputs/${encodeURIComponent(editing)}`, body, null)
      : await mutate('/api/config/inputs', { ...body, name: form.name.value.trim().toLowerCase() }, `Added ${form.name.value} — open its “Camera setup” for the camera settings.`);
    if (saved) dialog.close();
  });

  $('#add-input').addEventListener('click', async () => {
    await refresh();
    if (config.suggestedPort === null) return showBanner('All relay ports are in use — remove an input first.');
    openDialog(null);
  });

  // ---- per-card camera setup ----
  function bindCard(card, name) {
    const reveal = $('.cam-reveal', card);
    reveal.addEventListener('click', () => {
      const shown = card.dataset.revealed === '1';
      card.dataset.revealed = shown ? '' : '1';
      reveal.textContent = shown ? 'Reveal' : 'Hide';
      renderSetup(card);
    });
    $('.edit-input', card).addEventListener('click', async () => {
      await refresh();
      const input = byName().get(name);
      if (input) openDialog(input);
    });
    $('.regen-pass', card).addEventListener('click', () => {
      if (!confirm(`Generate a new passphrase for ${name}?\n\nThe camera must be updated with the new passphrase before it can connect again.`)) return;
      mutate(`/api/config/inputs/${encodeURIComponent(name)}/regenerate-passphrase`, {}, `New passphrase for ${name} — update the camera.`);
    });
    $('.remove-input', card).addEventListener('click', () => {
      if (!confirm(`Remove input ${name}?\n\nIts relay port stops listening. Existing recordings are NOT deleted.`)) return;
      mutate(`/api/config/inputs/${encodeURIComponent(name)}/delete`, {}, `Removed ${name}.`);
    });
  }

  function renderSetup(card) {
    const input = byName().get(card.dataset.input);
    if (!input) return;
    $('.cam-url', card).textContent = input.camera.url;
    $('.cam-port', card).textContent = String(input.camera.port);
    $('.cam-latency', card).textContent = `${input.latencyMs} ms`;
    $('.cam-pass', card).textContent = card.dataset.revealed === '1' ? input.passphrase : '••••••••••••';
  }

  return { refresh, bindCard, renderSetup, list: () => config.inputs };
}
