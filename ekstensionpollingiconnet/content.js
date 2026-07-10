/**
 * content.js — Asisten Pengisi Form (Batch Mode v2.0)
 *
 * Arsitektur: satu IIFE utama yang bercabang berdasarkan URL halaman:
 *   A) Iframe Google GSI  → klik tombol "Login dengan Google"
 *   B) Popup "Pilih Akun" → klik akun yang sesuai email iterasi
 *   C) Halaman form utama → jalankan bot 6-tahap
 */

(async function MAIN() {
  const origin = window.location.origin;
  const pathname = window.location.pathname;
  const search = window.location.search;
  const href = window.location.href;

  // ═══════════════════════════════════════════════════════════════════════════
  // KONTEKS A — Iframe Google GSI (accounts.google.com/gsi/button)
  // ═══════════════════════════════════════════════════════════════════════════
  if (origin === 'https://accounts.google.com' && pathname.includes('/gsi/button')) {
    console.log('[GSI-FRAME] Aktif — menunggu flag shouldClickGoogleBtn...');

    const POLL_MS = 400;
    const TIMEOUT_S = 60;
    let elapsed = 0;

    await new Promise(resolve => {
      const poll = setInterval(async () => {
        elapsed += POLL_MS;
        if (elapsed > TIMEOUT_S * 1000) { clearInterval(poll); resolve(); return; }

        const { shouldClickGoogleBtn, botActive } =
          await chrome.storage.local.get(['shouldClickGoogleBtn', 'botActive']);

        if (!botActive) { clearInterval(poll); resolve(); return; }

        if (shouldClickGoogleBtn) {
          const btn =
            document.querySelector('[role="button"][tabindex="0"]') ||
            document.querySelector('.nsm7Bb-HzV7m-LgbsSe') ||
            document.querySelector('[aria-labelledby="button-label"]');

          if (btn) {
            console.log('[GSI-FRAME] ✅ Mengklik tombol Login Google');
            btn.click();
            await chrome.storage.local.set({ shouldClickGoogleBtn: false });
            clearInterval(poll);
            resolve();
          }
        }
      }, POLL_MS);
    });
    return; // selesai, jangan lanjutkan ke logika lain
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KONTEKS B — Popup "Pilih Akun" Google (accountchooser / v3/signin)
  // ═══════════════════════════════════════════════════════════════════════════
  const isAccountChooser =
    origin === 'https://accounts.google.com' &&
    (pathname.includes('accountchooser') ||
      pathname.includes('/v3/signin') ||
      pathname.includes('/signin/v2') ||
      search.includes('accountchooser'));

  if (isAccountChooser) {
    console.log('[CHOOSER] Popup akun Google terdeteksi di content.js');

    // Ambil email target dari storage
    const { emails, currentIndex, botActive } =
      await chrome.storage.local.get(['emails', 'currentIndex', 'botActive']);

    if (!botActive || !emails || currentIndex >= emails.length) return;

    const target = emails[currentIndex].trim().toLowerCase();
    console.log('[CHOOSER] Mencari akun:', target);

    // Retry selama 15 detik (25 × 600ms)
    const MAX_TRIES = 25;
    const INTERVAL = 600;

    await new Promise(resolve => {
      let tries = 0;

      const poll = setInterval(() => {
        tries++;
        if (tries > MAX_TRIES) {
          clearInterval(poll);
          console.warn('[CHOOSER] ❌ Menyerah — akun tidak ditemukan:', target);
          resolve();
          return;
        }

        // — Strategi 1: data-identifier attribute (Google internal) —
        let el =
          document.querySelector(`[data-identifier="${target}"]`) ||
          document.querySelector(`[data-email="${target}"]`);

        // — Strategi 2: teks PERSIS sama dengan email —
        if (!el) {
          el = [...document.querySelectorAll('*')].find(e => {
            if (e.children.length > 3) return false;
            return e.textContent.trim().toLowerCase() === target;
          }) || null;
        }

        // — Strategi 3: teks MENGANDUNG email (lebih lebar) —
        if (!el) {
          el = [...document.querySelectorAll('*')].find(e => {
            if (e.children.length > 5) return false;
            const t = e.textContent.trim().toLowerCase();
            return t.includes(target) && t.length < 80;
          }) || null;
        }

        if (!el) {
          console.log(`[CHOOSER] Percobaan ${tries}: belum ditemukan`);
          return;
        }

        // Naik ke ancestor yang bisa diklik
        let clickEl = el;
        for (let i = 0; i < 8; i++) {
          if (!clickEl.parentElement) break;
          const role = clickEl.getAttribute?.('role') ?? '';
          const cursor = window.getComputedStyle(clickEl).cursor;
          const tag = clickEl.tagName;
          if (role === 'link' || role === 'button' || role === 'listitem' ||
            cursor === 'pointer' || tag === 'LI' || tag === 'A') break;
          clickEl = clickEl.parentElement;
        }

        clearInterval(poll);
        console.log('[CHOOSER] ✅ Mengklik:', clickEl.tagName,
          clickEl.textContent.trim().slice(0, 50));
        clickEl.scrollIntoView({ block: 'center' });

        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type =>
          clickEl.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
          }))
        );
        resolve();

      }, INTERVAL);
    });
    return; // selesai, jangan lanjutkan ke logika lain
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KONTEKS C — Halaman Form Utama — lanjutkan ke definisi fungsi & bot logic
  // ═══════════════════════════════════════════════════════════════════════════


  // ─── Utilitas ────────────────────────────────────────────────────────────────

  /** Tidur selama `ms` milidetik (non-blocking). */
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Cari elemen berdasarkan teks yang dikandungnya (case-insensitive).
   * @param {string} tag  - Tag HTML (mis. 'button', 'label', 'span')
   * @param {string} text - Potongan teks yang dicari
   * @returns {Element|null}
   */
  function findByText(tag, text) {
    const lc = text.toLowerCase();
    return [...document.querySelectorAll(tag)].find(
      el => el.textContent.trim().toLowerCase().includes(lc)
    ) ?? null;
  }

  /** Klik elemen dengan delay opsional sebelum klik. */
  async function clickEl(el, delayBefore = 0) {
    if (!el) return false;
    if (delayBefore > 0) await sleep(delayBefore);
    el.click();
    return true;
  }

  /** Kirim pesan status ke popup (fire-and-forget). */
  function notifyPopup(text, cls = 'status-running', current, total) {
    chrome.runtime.sendMessage({
      action: 'statusUpdate',
      text,
      cls,
      current,
      total,
    }).catch(() => { /* popup mungkin tertutup, abaikan error */ });
  }

  // ─── Bot Logic (Konteks C: Halaman Form) ───────────────────────────────────────
  // Beri sedikit jeda agar DOM benar-benar siap
  await sleep(1200);

  // ── Ambil state dari storage ─────────────────────────────────────────────
  const state = await chrome.storage.local.get([
    'emails',
    'currentIndex',
    'botActive',
  ]);

  const {
    emails = [],
    currentIndex = 0,
    botActive = false,
  } = state;

  // Jika bot tidak aktif, hentikan
  if (!botActive) return;

  // ── Semua email selesai ───────────────────────────────────────────────────
  if (currentIndex >= emails.length) {
    await chrome.storage.local.set({ botActive: false });
    chrome.runtime.sendMessage({ action: 'batchDone' }).catch(() => { });
    alert('✅ Semua email selesai diproses!');
    return;
  }

  const currentEmail = emails[currentIndex];
  const totalEmails = emails.length;

  console.log(`[BOT] Memproses email ke-${currentIndex + 1}/${totalEmails}: ${currentEmail}`);

  // Status awal saat halaman baru dimuat
  notifyPopup(
    `🔍 Memantau halaman untuk: ${currentEmail} (${currentIndex + 1}/${totalEmails})`,
    'status-running',
    currentIndex,
    totalEmails
  );

  // ── Variabel Pengunci ─────────────────────────────────────────────────────
  let sedangMenungguLogin = false;
  let emailSudahDiisi = false;
  let tahapSelesai = false;
  let heartbeatTick = 0;      // counter untuk heartbeat status
  let isActionRunning = false;

  // ── Loop Pemantauan ───────────────────────────────────────────────────────
  const INTERVAL_MS = 1500;

  const intervalId = setInterval(async () => {
    if (tahapSelesai) return;
    const allBoxCount = document.querySelectorAll('input[type="checkbox"]').length + document.querySelectorAll('[role="checkbox"]').length;
    console.log(`[BOT-LOOP] isActionRunning: ${isActionRunning}, Checkboxes: ${allBoxCount}, URL: ${window.location.search}`);
    if (isActionRunning) return;

    const bodyText = document.body.innerText ?? '';

    // ── Heartbeat: update status tiap 5 tick jika tidak ada tahap aktif ─────
    heartbeatTick++;
    if (heartbeatTick % 5 === 0 && !sedangMenungguLogin) {
      const pageUrl = window.location.hostname + window.location.pathname;
      notifyPopup(
        `⏳ ${currentEmail} (${currentIndex + 1}/${totalEmails}) — Memantau: ${pageUrl}`,
        'status-running',
        currentIndex,
        totalEmails
      );
    }

    // TAHAP 6 — "Terima Kasih Atas Partisipasinya"
    // ════════════════════════════════════════════════════════════════════════
    if (bodyText.toLowerCase().includes('terima kasih atas partisipasinya')) {
      tahapSelesai = true;
      clearInterval(intervalId);

      notifyPopup(
        `🎉 Selesai: ${currentEmail} (${currentIndex + 1}/${totalEmails}) — mengambil screenshot…`,
        'status-running',
        currentIndex + 1,
        totalEmails
      );

      // 6a. Screenshot via background.js
      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'takeScreenshot',
          email: currentEmail,
        });
        if (resp?.success) {
          console.log(`[BOT] Screenshot tersimpan: ${resp.filename}`);
        } else {
          console.warn('[BOT] Screenshot gagal:', resp?.error);
        }
      } catch (e) {
        console.warn('[BOT] Gagal mengirim pesan screenshot:', e);
      }

      // 6b. Jeda agar file sempat terunduh
      await sleep(2500);

      // 6c. Increment index dan simpan ke storage
      const nextIndex = currentIndex + 1;
      await chrome.storage.local.set({ currentIndex: nextIndex });

      notifyPopup(
        nextIndex >= totalEmails
          ? '✅ Batch selesai!'
          : `⏩ Lanjut ke email ke-${nextIndex + 1}: ${emails[nextIndex]}`,
        nextIndex >= totalEmails ? 'status-done' : 'status-running',
        nextIndex,
        totalEmails
      );

      // 6d. Klik refresh — halaman kembali ke awal form secara otomatis
      window.location.reload();

      return;
    }
    //
    // TAHAP 5 - Halaman ICONNET (card dengan radio button)
    //
    // Deteksi halaman ICONNET: ada teks "iconnet" DAN ada konteks halaman pemilihan perusahaan
    const hasIconNetText = bodyText.toLowerCase().includes('iconnet');
    const hasTelecomCompany = bodyText.toLowerCase().includes('perusahaan penyedia internet dan telekomunikasi') ||
      bodyText.toLowerCase().includes('energi & telekomunikasi: telecommunication') ||
      bodyText.toLowerCase().includes('telecommunication services') ||
      bodyText.toLowerCase().includes('klik logo perusahaan');

    if (hasIconNetText && hasTelecomCompany && !sedangMenungguLogin) {
      isActionRunning = true;
      try {
        notifyPopup(`🏢 TAHAP 5: Memilih ICONNET.`, 'status-running', currentIndex, totalEmails);
        await sleep(800);

        // Strategi 1: Cari elemen terkecil yang TEPAT mengandung "ICONNET"
        const allEls = [...document.querySelectorAll('div, a, button, label, span, li, article, section')];
        const iconnetEl = allEls.find(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const txt = el.textContent.replace(/\s+/g, ' ').trim();
          // Harus mengandung "ICONNET" tapi ukurannya kecil (bukan container utama)
          return txt.toUpperCase().includes('ICONNET') && txt.length < 120 && rect.height < 200;
        });

        console.log(`[BOT-T5] iconnetEl found: ${!!iconnetEl}, tag: ${iconnetEl?.tagName}, text: ${iconnetEl?.textContent?.trim()?.slice(0, 60)}`);

        if (iconnetEl) {
          // Klik card ICONNET
          iconnetEl.scrollIntoView({ block: 'center' });
          iconnetEl.click();
          await sleep(500);

          // Juga coba klik radio/input di dalam card
          const radio = iconnetEl.querySelector('input[type="radio"]') || iconnetEl.querySelector('[role="radio"]');
          if (radio) {
            radio.click();
            await sleep(300);
            console.log(`[BOT-T5] Radio inside ICONNET clicked`);
          }

          // Coba juga dispatch event pada parent card
          let cardParent = iconnetEl;
          for (let i = 0; i < 5; i++) {
            if (!cardParent.parentElement) break;
            const style = window.getComputedStyle(cardParent);
            if (style.cursor === 'pointer' || cardParent.getAttribute('role') === 'radio' ||
              cardParent.getAttribute('role') === 'option' || cardParent.classList.length > 2) {
              break;
            }
            cardParent = cardParent.parentElement;
          }
          if (cardParent !== iconnetEl) {
            cardParent.click();
            console.log(`[BOT-T5] Parent card clicked: ${cardParent.tagName}, classes: ${cardParent.className?.slice(0, 60)}`);
          }
        }

        await sleep(1500);

        // Klik tombol Lanjut
        const btnLanjut5 = findByText('button', 'lanjut')
          || findByText('a', 'lanjut')
          || findByText('div', 'lanjut')
          || findByText('span', 'lanjut');
        if (btnLanjut5) {
          btnLanjut5.scrollIntoView({ block: 'center' });
          await clickEl(btnLanjut5, 600);
          console.log(`[BOT-T5] Lanjut clicked`);
        } else {
          console.warn('[BOT-T5] Tombol Lanjut tidak ditemukan!');
        }
      } finally {
        await sleep(2500);
        isActionRunning = false;
      }
      return;
    }

    // TAHAP 4 - Centang 3 Kriteria Teratas & klik Lanjut
    // Hanya cari elemen [role="checkbox"] (bukan <input> tersembunyi di dalamnya)
    //
    const roleCheckboxes = [...document.querySelectorAll('[role="checkbox"]')];
    const uncheckedBoxes = roleCheckboxes.filter(cb => cb.getAttribute('aria-checked') === 'false').slice(0, 3);

    console.log(`[BOT-T4] uncheckedBoxes: ${uncheckedBoxes.length}, roleCheckboxes: ${roleCheckboxes.length}, sedangMenungguLogin: ${sedangMenungguLogin}`);
    if (uncheckedBoxes.length >= 3 && !sedangMenungguLogin) {
      isActionRunning = true;
      try {
        notifyPopup(`?? TAHAP 4: Mencentang 3 kriteria.`, 'status-running', currentIndex, totalEmails);

        for (const cb of uncheckedBoxes) {
          // Klik langsung pada div[role=checkbox] — React mendengar event ini
          cb.click();
          await sleep(600);

          // Cek apakah klik berhasil
          const nowChecked = cb.getAttribute('aria-checked');
          console.log(`[BOT-T4] Klik checkbox: aria-checked sekarang = ${nowChecked}`);

          // Jika .click() tidak berhasil, coba klik label di dalamnya
          if (nowChecked !== 'true') {
            const label = cb.querySelector('label');
            if (label) {
              label.click();
              await sleep(400);
              console.log(`[BOT-T4] Fallback klik label: aria-checked = ${cb.getAttribute('aria-checked')}`);
            }
          }

          // Jika masih belum berhasil, coba klik <input> di dalam
          if (cb.getAttribute('aria-checked') !== 'true') {
            const innerInput = cb.querySelector('input[type="checkbox"]');
            if (innerInput && !innerInput.checked) {
              innerInput.click();
              await sleep(400);
              console.log(`[BOT-T4] Fallback klik input: checked = ${innerInput.checked}`);
            }
          }
        }

        await sleep(1000);
        const btnLanjut4 = findByText('button', 'lanjut')
          || findByText('button', 'next')
          || findByText('div', 'lanjut')
          || findByText('span', 'lanjut')
          || findByText('a', 'lanjut');
        if (btnLanjut4) {
          btnLanjut4.scrollIntoView({ block: 'center' });
          await clickEl(btnLanjut4, 600);
        } else {
          console.warn('[BOT-T4] Tombol Lanjut tidak ditemukan!');
        }
      } finally {
        await sleep(2500);
        isActionRunning = false;
      }
      return;
    }
    // TAHAP 3 - Pilih "Telecommunication Services" (sub-sektor) - deteksi via URL
    //
    const isSubSektor = window.location.search.toLowerCase().includes('sub_sector')
      || window.location.href.toLowerCase().includes('sub_sector')
      || window.location.href.toLowerCase().includes('subsektor');

    console.log(`[BOT-T3] isSubSektor: ${isSubSektor}, sedangMenungguLogin: ${sedangMenungguLogin}`);
    if (isSubSektor && !sedangMenungguLogin) {
      isActionRunning = true;
      try {
        notifyPopup(`📡 TAHAP 3: Memilih Telecommunication Services.`, 'status-running', currentIndex, totalEmails);
        await sleep(800);

        // Cari card "Telecommunication Services" - elemen visible yang mengandung "telecommunication" tapi bukan container besar
        const allCandidates = [...document.querySelectorAll('a, button, div, li, article, h1, h2, h3, p, span')];
        const telecomEl = allCandidates.find(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const txt = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
          // Harus mengandung "telecommunication" tapi TIDAK "energy" (hindari container besar)
          return txt.includes('telecommunication') && !txt.includes('energy') && txt.length < 150;
        });

        if (telecomEl) {
          telecomEl.scrollIntoView({ block: 'center' });
          ['mousedown', 'mouseup', 'click'].forEach(type =>
            telecomEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
          );
        } else {
          console.warn('[BOT] Elemen Telecommunication Services tidak ditemukan di halaman sub-sektor!');
        }
      } finally {
        await sleep(2500);
        isActionRunning = false;
      }
      return;
    }

    //
    // TAHAP 2 - Deteksi Halaman Pemilihan Sektor & buka kunci login
    // Halaman ini menampilkan daftar SEKTOR (bukan sub-sektor), URL biasanya state=sector_list
    //
    const isSektor = (bodyText.toLowerCase().includes('energi & telekomunikasi')
      || bodyText.toLowerCase().includes('energi dan telekomunikasi'))
      && !isSubSektor;  // jangan trigger jika sudah di halaman sub-sektor

    console.log(`[BOT-T2] isSektor: ${isSektor}, sedangMenungguLogin: ${sedangMenungguLogin}`);
    if (isSektor) {
      if (sedangMenungguLogin) {
        sedangMenungguLogin = false;
        notifyPopup(`?? Login berhasil! Melanjutkan.`, 'status-running', currentIndex, totalEmails);
      }
      isActionRunning = true;
      try {
        notifyPopup(`?? TAHAP 2: Memilih Energi & Telekomunikasi.`, 'status-running', currentIndex, totalEmails);
        await sleep(800);

        // Cari card sektor - elemen visible terkecil yang mengandung "energi" tapi bukan "energy" (english)
        const allSektorCandidates = [...document.querySelectorAll('a, button, div, li, article, h1, h2, h3, span')];
        const btnSektor = allSektorCandidates.find(el => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;
          const txt = el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
          return (txt.includes('energi & telekomunikasi') || txt.includes('energi dan telekomunikasi'))
            && txt.length < 100;
        });

        if (btnSektor) {
          btnSektor.scrollIntoView({ block: 'center' });
          ['mousedown', 'mouseup', 'click'].forEach(type =>
            btnSektor.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
          );
        } else {
          console.warn('[BOT] Card Energi & Telekomunikasi tidak ditemukan!');
        }
      } finally {
        await sleep(2500);
        isActionRunning = false;
      }
      return;
    }
    // ════════════════════════════════════════════════════════════════════════
    // TAHAP 1 — Halaman "Lengkapi Data Diri"
    // ════════════════════════════════════════════════════════════════════════
    const isDataDiri = bodyText.toLowerCase().includes('lengkapi data diri');

    console.log(`[BOT-T1] isDataDiri: ${isDataDiri}, emailSudahDiisi: ${emailSudahDiisi}, sedangMenungguLogin: ${sedangMenungguLogin}`);
    if (isDataDiri && !emailSudahDiisi && !sedangMenungguLogin) {
      notifyPopup(`📝 TAHAP 1: Mengisi data diri…`, 'status-running', currentIndex, totalEmails);

      // ── Isi field email ────────────────────────────────────────────────────
      const emailInput =
        document.querySelector('input[type="email"]') ||
        document.querySelector('input[name*="email" i]') ||
        document.querySelector('input[id*="email" i]') ||
        document.querySelector('input[placeholder*="email" i]');

      if (emailInput) {
        emailInput.focus();
        emailInput.value = currentEmail;
        // Trigger event agar framework (React/Vue/Angular) mendeteksi perubahan
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // ── Centang persetujuan ──
      await sleep(500);
      const checkboxes = document.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
      for (const cb of checkboxes) {
        const isChecked = cb.tagName === 'INPUT' ? cb.checked : cb.getAttribute('aria-checked') === 'true';
        if (!isChecked) {
          const labelEl = cb.querySelector('label');
          const targetToClick = labelEl || cb;
          ['mousedown', 'mouseup', 'click'].forEach(type => {
            targetToClick.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          });
          await sleep(300);
        }
      }

      emailSudahDiisi = true;

      // ── Sinyal ke iframe Google GSI untuk klik tombol ─────────────────────
      // Tombol "Login dengan Google" ada di dalam iframe cross-origin dari
      // accounts.google.com — tidak bisa diklik langsung dari sini.
      // Solusi: set flag di storage, lalu handler di atas (konteks iframe)
      // yang membaca flag dan klik tombol dari DALAM iframe itu sendiri.
      await sleep(1500);
      await chrome.storage.local.set({ shouldClickGoogleBtn: true });
      sedangMenungguLogin = true;

      // Beri tahu background.js untuk aktif mencari tab popup Google
      chrome.runtime.sendMessage({
        action: 'watchForGooglePopup',
        targetEmail: currentEmail,
      }).catch(() => { });

      notifyPopup(
        `🖱️ Mengklik Login Google & memilih akun: ${currentEmail}`,
        'status-running',
        currentIndex,
        totalEmails
      );
    }


  }, INTERVAL_MS);

  // ─── Tutup MAIN IIFE ────────────────────────────────────────────────────────────────
})(); // end MAIN IIFE
