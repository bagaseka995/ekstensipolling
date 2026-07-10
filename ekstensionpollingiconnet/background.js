/**
 * background.js — Service Worker (Manifest V3)
 * Asisten Pengisi Form v2.0
 *
 * Tanggung jawab:
 *  1. Auto-Screenshot saat polling selesai (pesan takeScreenshot)
 *  2. Auto-klik akun Google yang sesuai di popup "Pilih akun"
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LISTENER PESAN DARI CONTENT.JS
// ═══════════════════════════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── Pesan: takeScreenshot ────────────────────────────────────────────────
  if (message.action === 'takeScreenshot') {
    const email    = message.email ?? 'unknown';
    const tabId    = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    if (!tabId) {
      sendResponse({ success: false, error: 'Tab ID tidak ditemukan.' });
      return true;
    }

    (async () => {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
          format : 'png',
          quality: 100,
        });

        const safeName  = email.replace(/[^a-zA-Z0-9._@-]/g, '_');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename  = `Polling_Selesai_${safeName}_${timestamp}.png`;

        const downloadId = await chrome.downloads.download({
          url     : dataUrl,
          filename: filename, // Langsung disimpan di folder download utama Chrome
          saveAs  : false,
        });

        console.log(`[BG] Screenshot disimpan — downloadId: ${downloadId}, file: ${filename}`);
        sendResponse({ success: true, filename });
      } catch (err) {
        console.error('[BG] Gagal mengambil/menyimpan screenshot:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Menjaga channel pesan tetap terbuka secara asinkron
  }

  // ── Pesan: watchForGooglePopup ─────────────────────────────────────────
  // Dipanggil content.js setelah tombol GSI diklik.
  // Aktif poll SEMUA tab (tanpa filter URL) lalu saring manual —
  // lebih andal daripada query dengan match-pattern yang bisa gagal
  // untuk popup window.
  if (message.action === 'watchForGooglePopup') {
    const targetEmail = (message.targetEmail ?? '').trim().toLowerCase();
    console.log(`[BG] Mulai memantau popup Google untuk: ${targetEmail}`);

    let   attempts     = 0;
    const MAX_ATTEMPTS = 60;  // 60 × 1000ms = 60 detik timeout
    let   injected     = false;

    const watchTimer = setInterval(async () => {
      if (injected) { clearInterval(watchTimer); return; }

      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(watchTimer);
        console.warn('[BG] Timeout 60s: tab popup Google tidak ditemukan.');
        return;
      }

      // Query SEMUA tab tanpa filter — hindari masalah match-pattern pada popup
      let allTabs = [];
      try {
        allTabs = await chrome.tabs.query({});
      } catch (e) {
        return;
      }

      // Saring secara manual: URL mengandung accounts.google.com + signin/accountchooser
      const chooserTab = allTabs.find(t => {
        const u = t.url ?? '';
        return (
          u.includes('accounts.google.com') &&
          (
            u.includes('accountchooser') ||
            u.includes('/v3/signin')     ||
            u.includes('/signin/v2')     ||
            u.includes('/signin/oauth')
          )
        );
      });

      if (!chooserTab) {
        console.log(`[BG] Percobaan ${attempts}: tab belum ditemukan...`);
        return;
      }

      // Tunggu tab selesai loading
      if (chooserTab.status !== 'complete') {
        console.log(`[BG] Tab ditemukan tapi masih loading (status: ${chooserTab.status})`);
        return;
      }

      // Tandai sudah diinjeksikan supaya tidak double-inject
      injected = true;
      clearInterval(watchTimer);
      console.log(`[BG] ✅ Tab akun Google ditemukan! id=${chooserTab.id} url=${chooserTab.url?.slice(0,70)}`);

      // Sedikit jeda agar React/Vue di halaman selesai render daftar akun
      await new Promise(r => setTimeout(r, 800));

      try {
        await chrome.scripting.executeScript({
          target: { tabId: chooserTab.id, allFrames: false },
          func  : autoClickGoogleAccount,
          args  : [targetEmail],
        });
        console.log(`[BG] Script berhasil diinjeksikan ke tab ${chooserTab.id}`);
      } catch (err) {
        console.warn('[BG] executeScript gagal:', err.message);
      }

    }, 1000);

    sendResponse({ started: true });
    return true;
  }
});





// ═══════════════════════════════════════════════════════════════════════════════
// 2. FALLBACK: tabs.onUpdated (cadangan jika watchForGooglePopup tidak terpanggil)
// ═══════════════════════════════════════════════════════════════════════════════
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const url = tab.url ?? '';
  if (!url.includes('accounts.google.com')) return;
  if (!url.includes('accountchooser') && !url.includes('/v3/signin') &&
      !url.includes('/signin/v2')) return;

  const { emails, currentIndex, botActive } =
    await chrome.storage.local.get(['emails', 'currentIndex', 'botActive']);
  if (!botActive || !emails || currentIndex >= emails.length) return;

  const targetEmail = emails[currentIndex].trim().toLowerCase();
  console.log(`[BG] onUpdated: popup Google terdeteksi, email: ${targetEmail}`);

  await new Promise(r => setTimeout(r, 800));
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      func  : autoClickGoogleAccount,
      args  : [targetEmail],
    });
  } catch (err) {
    console.warn('[BG] onUpdated executeScript gagal:', err.message);
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// 3. FUNGSI PEMILIH AKUN (diinjeksikan ke popup Google)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Cari dan klik baris akun yang email-nya cocok dengan targetEmail.
 * Menggunakan 3 strategi berurutan:
 *   A) data-identifier / data-email attribute (selector paling spesifik Google)
 *   B) Pencarian teks email di semua elemen kecil
 *   C) Klik parent container yang punya cursor:pointer
 */
function autoClickGoogleAccount(targetEmail) {
  const MAX_TRIES = 15;
  const INTERVAL  = 600;
  let   tries     = 0;

  console.log('[CHOOSER] Script aktif, mencari:', targetEmail);

  const poll = setInterval(() => {
    tries++;
    if (tries > MAX_TRIES) {
      clearInterval(poll);
      console.warn('[CHOOSER] Menyerah setelah', MAX_TRIES, 'percobaan. Email:', targetEmail);
      return;
    }

    // ── Strategi A: data-identifier atau data-email attribute ──────────────
    let clickTarget =
      document.querySelector(`[data-identifier="${targetEmail}"]`) ??
      document.querySelector(`[data-email="${targetEmail}"]`)       ??
      document.querySelector(`[data-value="${targetEmail}"]`);

    // ── Strategi B: Cari elemen teks kecil yang isinya = email ────────────
    if (!clickTarget) {
      const allEls = [...document.querySelectorAll('*')];
      for (const el of allEls) {
        if (el.children.length > 4) continue; // lewati kontainer besar
        const txt = el.textContent.trim().toLowerCase();
        if (txt === targetEmail) {
          clickTarget = el;
          break;
        }
      }
    }

    if (!clickTarget) {
      console.log(`[CHOOSER] Percobaan ${tries}: elemen belum ditemukan`);
      return;
    }

    // ── Strategi C: Naik ke ancestor yang bisa diklik ─────────────────────
    let finalTarget = clickTarget;
    for (let i = 0; i < 8; i++) {
      if (!finalTarget.parentElement) break;
      const role   = finalTarget.getAttribute?.('role') ?? '';
      const cursor = window.getComputedStyle(finalTarget).cursor;
      const tag    = finalTarget.tagName;
      if (role === 'link' || role === 'button' || role === 'listitem' ||
          cursor === 'pointer' || tag === 'LI' || tag === 'A') {
        break;
      }
      finalTarget = finalTarget.parentElement;
    }

    clearInterval(poll);
    console.log('[CHOOSER] ✅ Mengklik:', finalTarget.tagName, finalTarget.textContent.trim().slice(0,50));
    finalTarget.scrollIntoView({ block: 'center' });

    // Kirim sequence event mouse yang lengkap
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(type => {
      finalTarget.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
      }));
    });

  }, INTERVAL);
}
