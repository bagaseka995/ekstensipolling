/**
 * popup.js — Asisten Pengisi Form (Batch Mode v2.0)
 * Mengelola input email batch, menyimpan state ke chrome.storage.local,
 * dan memulai/menghentikan proses otomasi.
 */

// ─── Elemen DOM ──────────────────────────────────────────────────────────────
const emailListEl   = document.getElementById('emailList');
const countNumEl    = document.getElementById('countNum');
const statusBox     = document.getElementById('statusBox');
const progressBar   = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const btnStart      = document.getElementById('btnStart');
const btnStop       = document.getElementById('btnStop');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pecah textarea menjadi array email bersih:
 * split newline → trim → buang yang kosong/invalid.
 */
function parseEmails(raw) {
  return raw
    .split('\n')
    .map(e => e.trim())
    .filter(e => e.length > 0 && e.includes('@'));
}

/** Tampilkan pesan status dengan kelas warna tertentu. */
function setStatus(msg, cls = 'status-idle') {
  statusBox.className = cls;
  statusBox.textContent = msg;
}

/** Perbarui progress bar dan label. */
function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressLabel.textContent = `${current} / ${total}`;
}

/** Toggle tombol aktif/nonaktif. */
function setRunningUI(isRunning) {
  btnStart.disabled = isRunning;
  btnStop.disabled  = !isRunning;
}

// ─── Hitung email secara real-time ───────────────────────────────────────────
emailListEl.addEventListener('input', () => {
  const emails = parseEmails(emailListEl.value);
  countNumEl.textContent = emails.length;
});

// ─── Restore state saat popup dibuka kembali ─────────────────────────────────
chrome.storage.local.get(
  ['emails', 'currentIndex', 'botActive'],
  (data) => {
    const { emails = [], currentIndex = 0, botActive = false } = data;

    // Isi kembali textarea
    if (emails.length > 0) {
      emailListEl.value = emails.join('\n');
      countNumEl.textContent = emails.length;
    }

    if (botActive) {
      setRunningUI(true);
      setStatus(
        `🔄 Proses berjalan… Email ke-${currentIndex + 1} dari ${emails.length}`,
        'status-running'
      );
      updateProgress(currentIndex, emails.length);
    } else if (emails.length > 0 && currentIndex >= emails.length) {
      setStatus('✅ Semua email selesai diproses!', 'status-done');
      updateProgress(emails.length, emails.length);
    }
  }
);

// ─── Listener pesan dari content.js (update status) ──────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'statusUpdate') {
    setStatus(message.text, message.cls ?? 'status-running');
    if (message.current !== undefined && message.total !== undefined) {
      updateProgress(message.current, message.total);
    }
  }

  if (message.action === 'batchDone') {
    setStatus('✅ Semua email selesai diproses!', 'status-done');
    setRunningUI(false);
    chrome.storage.local.get(['emails'], (d) => {
      updateProgress(d.emails?.length ?? 0, d.emails?.length ?? 0);
    });
  }
});

// ─── Tombol MULAI ─────────────────────────────────────────────────────────────
btnStart.addEventListener('click', async () => {
  const raw    = emailListEl.value;
  const emails = parseEmails(raw);

  // Validasi
  if (emails.length === 0) {
    setStatus('⚠️ Masukkan minimal satu email yang valid.', 'status-warning');
    return;
  }

  // Simpan state awal ke storage
  await chrome.storage.local.set({
    emails,
    currentIndex : 0,
    botActive    : true,
  });

  setRunningUI(true);
  setStatus(`🚀 Memulai batch: ${emails.length} email. Silakan pastikan kamu sudah di halaman form.`, 'status-running');
  updateProgress(0, emails.length);

  // Reload tab aktif — content.js akan otomatis berjalan
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.reload(tab.id);
});

// ─── Tombol HENTIKAN ──────────────────────────────────────────────────────────
btnStop.addEventListener('click', async () => {
  await chrome.storage.local.set({ botActive: false });
  setRunningUI(false);
  setStatus('⏹ Proses dihentikan oleh pengguna.', 'status-warning');
});
