/* =====================================================================
   SILAT-DeLa — mesin offline untuk halaman GitHub
   Menggantikan google.script.run: data dibaca dari server bila online,
   disimpan di perangkat bila offline, lalu dikirim otomatis saat ada sinyal.
   ===================================================================== */
(function () {
  'use strict';

  // ======================= PENGATURAN =======================
  // Link /exec aplikasi (Apps Script > Terapkan > Kelola deployment)
  const API = window.SILAT_API || 'https://script.google.com/macros/s/AKfycbwmvuPZF_i-ge0HZqs9u3lkiM9RqPktAxY6kRNcgejzpOlbUMBgCFEixP7gtMGcNqw/exec';
  const MASA_HARI = 60;            // izin offline per perangkat
  // ==========================================================

  const BACA = new Set(['getKonfig', 'getDashboardData', 'getDataSheet', 'getArsipData', 'getLayananData', 'getNotifikasi', 'getRekapKinerja', 'getRiwayat', 'getUsers', 'getCetakData']);
  const TULIS = new Set(['simpanData', 'simpanArsip', 'simpanLayananData', 'tandaiDibaca', 'simpanFotoSaya']);
  const ONLINE_SAJA = new Set(['gantiPasswordAwal', 'gantiPasswordSaya', 'hapusDataRow', 'hapusUser', 'resetPasswordUser', 'simpanUser', 'getLampiran', 'getLampiranArsip', 'simpanLatar', 'resetLatar']);

  // ---------------------------------------------------------------- penyimpanan (IndexedDB)
  let dbP = null;
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  function db() {
    if (!dbP) dbP = new Promise((res, rej) => {
      const r = indexedDB.open('silat-dela', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('antrian')) d.createObjectStore('antrian', { keyPath: 'qid' });
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbP;
  }
  const store = async (n, m) => (await db()).transaction(n, m || 'readonly').objectStore(n);
  const kvGet = async k => req((await store('kv')).get(k));
  const kvSet = async (k, v) => req((await store('kv', 'readwrite')).put(v, k));
  const kvKeys = async () => req((await store('kv')).getAllKeys());
  const qAll = async () => req((await store('antrian')).getAll());
  const qPut = async it => req((await store('antrian', 'readwrite')).put(it));
  const qDel = async id => req((await store('antrian', 'readwrite')).delete(id));
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { }

  // ---------------------------------------------------------------- utilitas
  const salin = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const b64e = u8 => btoa(String.fromCharCode.apply(null, Array.from(u8)));
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const tunggu = ms => new Promise(r => setTimeout(r, ms));
  async function hashPw(pw, saltB64) {
    const salt = saltB64 ? b64d(saltB64) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, key, 256);
    return { salt: b64e(salt), hash: b64e(new Uint8Array(bits)) };
  }

  // ---------------------------------------------------------------- status koneksi
  let offline = !navigator.onLine, lewatiJaringanSampai = 0, perluLogin = false;
  const errJaringan = m => { const e = new Error('Tidak ada koneksi internet (' + m + ')'); e.isJaringan = true; return e; };
  function tandaiOffline(v) {
    const lama = offline; offline = v;
    if (v) lewatiJaringanSampai = Date.now() + 30000; else lewatiJaringanSampai = 0;
    if (lama !== v) perbaruiStatus();
  }

  async function kirimApi(body, ms) {
    if (!/^https:/.test(API)) throw new Error('Link aplikasi (SILAT_API) belum diisi di offline.js.');
    if (!navigator.onLine) throw errJaringan('perangkat offline');
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 60000);
    let r;
    try {
      r = await fetch(API, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctl.signal, redirect: 'follow' });
    } catch (e) { throw errJaringan(e.name === 'AbortError' ? 'waktu habis' : e.message); }
    finally { clearTimeout(t); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Server tidak menjawab dengan benar. Pastikan deployment Apps Script diatur "Siapa saja" (Anyone).'); }
    tandaiOffline(false);
    return j;
  }

  // ---------------------------------------------------------------- akun & kunci perangkat
  let aktif = null;   // username (huruf kecil) yang sedang login
  const kunciAuth = u => 'auth:' + String(u).trim().toLowerCase();
  async function authDari(u) { return u ? kvGet(kunciAuth(u)) : null; }

  async function panggilServer(fn, args, qid, user, ms) {
    const a = await authDari(user || aktif);
    if (!a || !a.kunci) { const e = new Error('Sesi berakhir: perangkat perlu login ulang saat online.'); e.perluLogin = true; throw e; }
    const j = await kirimApi({ aksi: 'panggil', kunci: a.kunci, fn, args, qid }, ms);
    if (j.berlaku) { a.berlaku = j.berlaku; a.terakhir = Date.now(); await kvSet(kunciAuth(a.username), a); }
    if (!j.ok) {
      if (j.perluLogin) { a.kunci = null; await kvSet(kunciAuth(a.username), a); perluLogin = true; perbaruiStatus(); const e = new Error(j.error); e.perluLogin = true; throw e; }
      throw new Error(j.error || 'Terjadi kesalahan di server.');
    }
    perluLogin = false;
    return j.hasil;
  }

  async function masuk(u, p) {
    const un = String(u || '').trim(), pw = String(p || '').trim(), kk = kunciAuth(un);
    const gagalKey = 'gagal:' + un.toLowerCase();
    try {
      const j = await kirimApi({ aksi: 'login', u: un, p: pw, perangkat: navigator.userAgent }, 45000);
      if (!j.ok) return { status: 'gagal', error: j.error };
      const r = j.hasil;
      if (r.status !== 'sukses') return r;
      const h = await hashPw(pw), profil = salin(r);
      delete profil.token; delete profil.status;
      await kvSet(kk, { username: r.username, salt: h.salt, hash: h.hash, profil, kunci: j.kunci, berlaku: j.berlaku, terakhir: Date.now() });
      await kvSet(gagalKey, 0);
      aktif = r.username.toLowerCase(); perluLogin = false;
      setTimeout(sinkron, 800);
      return Object.assign({}, r, { token: 'perangkat' });
    } catch (e) {
      if (!e.isJaringan) return { status: 'gagal', error: e.message };
      tandaiOffline(true);
      const a = await kvGet(kk);
      if (!a) return { status: 'gagal', error: 'Tidak ada koneksi internet. Akun ini belum pernah login di perangkat ini saat online, jadi belum bisa dipakai offline. Sambungkan internet untuk login pertama kali.' };
      if (!a.kunci) return { status: 'gagal', error: 'Tidak ada koneksi internet. Akun ini perlu login ulang saat online (password diganti atau izin dicabut).' };
      if (!a.berlaku || new Date(a.berlaku) < new Date()) return { status: 'gagal', error: 'Izin offline ' + MASA_HARI + ' hari sudah habis. Sambungkan internet lalu login ulang.' };
      const gagal = (await kvGet(gagalKey)) || 0, kunciWaktu = (await kvGet(gagalKey + ':sampai')) || 0;
      if (gagal >= 5 && Date.now() < kunciWaktu) return { status: 'gagal', error: 'Terlalu banyak percobaan salah. Coba lagi 10 menit lagi.' };
      const h = await hashPw(pw, a.salt);
      if (h.hash !== a.hash) {
        await kvSet(gagalKey, gagal + 1); if (gagal + 1 >= 5) await kvSet(gagalKey + ':sampai', Date.now() + 600000);
        return { status: 'gagal', error: 'Username atau Password salah! (mode offline)' };
      }
      if (a.profil.wajibGanti) return { status: 'gagal', error: 'Anda wajib mengganti password terlebih dahulu. Sambungkan internet untuk melanjutkan.' };
      await kvSet(gagalKey, 0);
      aktif = a.username.toLowerCase();
      setTimeout(() => toast('Mode offline: data disimpan di perangkat dan dikirim saat ada sinyal', 'warning', 4000), 1500);
      return Object.assign({ status: 'sukses', token: 'offline' }, a.profil);
    }
  }

  async function profilAktif() { const a = await authDari(aktif); return a ? a.profil : {}; }

  // ---------------------------------------------------------------- membaca data (server / salinan di perangkat)
  const kunciCache = (u, fn, a) => 'c:' + u + ':' + fn + ':' + JSON.stringify(a);
  async function baca(fn, a) {
    const key = kunciCache(aktif, fn, a);
    if (!offline || Date.now() > lewatiJaringanSampai) {
      try {
        const r = await panggilServer(fn, a, null, null, 25000);
        await kvSet(key, { t: Date.now(), v: r });
        if (fn === 'getKonfig') jadwalUnduh(r);
        return gabung(fn, a, r);
      } catch (e) { if (!e.isJaringan) throw e; tandaiOffline(true); }
    }
    const c = await kvGet(key);
    if (!c) throw new Error('Data ini belum tersimpan di perangkat. Buka menu ini sekali saat online agar bisa dibuka tanpa sinyal.');
    return gabung(fn, a, c.v);
  }

  // Menampilkan data yang belum terkirim di daftar, dengan tanda "Belum terkirim"
  async function gabung(fn, a, hasil) {
    if (['getArsipData', 'getDataSheet', 'getLayananData'].indexOf(fn) === -1 || !Array.isArray(hasil)) return salin(hasil);
    const res = salin(hasil);
    const q = (await qAll()).filter(x => x.user === aktif).sort((x, y) => x.dibuat - y.dibuat);
    let semu = -1000;
    const p = await profilAktif(), unit = /kecamatan/i.test(p.role || '') ? 'Kecamatan' : p.desa;
    if (fn === 'getArsipData') q.filter(x => x.fn === 'simpanArsip' && x.args[0] === a[0]).forEach(x => {
      const f = x.args[1], idx = Number(f.editRowIndex) || -1;
      if (idx > 0) { const r = res.find(y => y.rowIndex === idx); if (r) { r.v = Object.assign({}, r.v, f.v); r._pending = true; } }
      else res.unshift({ rowIndex: semu--, v: f.v, file: '', _pending: true });
    });
    if (fn === 'getDataSheet') q.filter(x => x.fn === 'simpanData' && x.args[1] === a[0]).forEach(x => {
      const f = x.args[0], idx = Number(f.editRowIndex) || -1, kades = String(f.jabatan).trim().toLowerCase() === 'kepala desa';
      if ((a[1] === 'kades' && !kades) || (a[1] === 'perangkat' && kades)) return;
      const isi = { nama: f.nama, nik: f.nik, tempat: f.tempat, tgl: f.tgl, desa: f.desa, jabatan: f.jabatan, jk: f.jk, hp: f.hp, tmt: f.tmt, alamat: f.alamat };
      if (idx > 0) { const r = res.find(y => y.rowIndex === idx); if (r) { Object.assign(r, isi); r._pending = true; } }
      else res.unshift(Object.assign(isi, { foto: '', ijazah: '', sk: '', rowIndex: semu--, _pending: true }));
    });
    if (fn === 'getLayananData') {
      q.filter(x => x.fn === 'simpanLayananData' && x.args[1] === a[0] && x.args[0].bagian === a[1]).forEach(x => {
        const f = x.args[0], idx = Number(f.editRowIndex) || -1;
        if (idx > 0) { const r = res.find(y => y.rowIndex === idx); if (r) { Object.assign(r, { tanggal: f.tanggal, jenis: f.jenis, keterangan: f.keterangan, tujuan: f.tujuan, waktu: f.waktu }); r._pending = true; } return; }
        const tj = String(f.tujuan || '').split(',').map(s => s.trim()).filter(Boolean);
        res.unshift({ rowIndex: semu--, tanggal: f.tanggal, jenis: f.jenis, keterangan: f.keterangan, tujuan: f.tujuan, waktu: f.waktu, fileUrl: '', pengirim: unit, ref: f.ref || '',
          penerima: tj, dibaca: [], isPengirim: true, isPenerima: false, sudahDibaca: true, jmlPenerima: tj.length, jmlDibaca: 0, jmlDibalas: 0, dibalasOleh: [], refJenis: '', _pending: true });
      });
      if (a[0] === 'Permintaan') {
        q.filter(x => x.fn === 'simpanLayananData' && x.args[1] === 'Pemenuhan_Permintaan' && x.args[0].ref).forEach(x => { res.forEach(r => { if (r.id === x.args[0].ref) { r.sudahDibalas = true; r.sudahDibaca = true; } }); });
      }
      q.filter(x => x.fn === 'tandaiDibaca' && x.args[0] === a[0]).forEach(x => { res.forEach(r => { if (r.id === x.args[1]) r.sudahDibaca = true; }); });
    }
    return res;
  }

  // Unduh semua menu ke perangkat setelah login online, agar siap dibuka tanpa sinyal
  let unduhJalan = false;
  function jadwalUnduh(konf) { setTimeout(() => unduhSemua(konf), 1500); }
  async function unduhSemua(konf) {
    if (unduhJalan || !aktif) return;
    const tanda = 'unduh:' + aktif, terakhir = (await kvGet(tanda)) || 0;
    if (Date.now() - terakhir < 10 * 60000) return;
    unduhJalan = true;
    try {
      const p = await profilAktif(), kec = /kecamatan/i.test(p.role || ''), bag = kec ? null : (/bpd/i.test(p.role || '') ? 'BPD' : 'Desa');
      const daftar = [['getDashboardData', []], ['getNotifikasi', []]];
      if (typeof PEGAWAI !== 'undefined') Object.keys(PEGAWAI).forEach(k => {
        const g = PEGAWAI[k], b = g.sheet === 'Data_BPD' ? 'BPD' : 'Desa';
        if (kec || b === bag) daftar.push(['getDataSheet', [g.sheet, g.mode]]);
      });
      Object.keys((konf && konf.arsip) || {}).forEach(s => { if (kec || konf.arsip[s].bagian === bag) daftar.push(['getArsipData', [s]]); });
      ['Permintaan', 'Pemenuhan_Permintaan'].forEach(t => (kec ? ['Desa', 'BPD'] : [bag]).forEach(b => daftar.push(['getLayananData', [t, b]])));
      for (const [fn, a] of daftar) {
        if (offline) break;
        try { const r = await panggilServer(fn, a, null, null, 30000); await kvSet(kunciCache(aktif, fn, a), { t: Date.now(), v: r }); } catch (e) { if (e.isJaringan) break; }
        await tunggu(150);
      }
      if (!offline) await kvSet(tanda, Date.now());
    } finally { unduhJalan = false; }
  }

  // Setelah data terkirim, perbarui salinan di perangkat
  async function segarkan(fns) {
    if (offline) return;
    const kunci = (await kvKeys()).filter(k => typeof k === 'string' && k.indexOf('c:' + aktif + ':') === 0 && fns.some(f => k.indexOf(':' + f + ':') > 0));
    for (const k of kunci) {
      const sisa = k.slice(('c:' + aktif + ':').length), i = sisa.indexOf(':'), fn = sisa.slice(0, i);
      let a; try { a = JSON.parse(sisa.slice(i + 1)); } catch (e) { continue; }
      try { const r = await panggilServer(fn, a, null, null, 30000); await kvSet(k, { t: Date.now(), v: r }); } catch (e) { if (e.isJaringan) return; }
    }
  }
  const TERKAIT = { simpanArsip: ['getArsipData', 'getDashboardData'], simpanData: ['getDataSheet', 'getDashboardData'], simpanLayananData: ['getLayananData', 'getNotifikasi', 'getDashboardData'], tandaiDibaca: ['getLayananData', 'getNotifikasi'], simpanFotoSaya: [] };

  // ---------------------------------------------------------------- menyimpan (antrian kirim)
  function labelItem(fn, a) {
    try {
      const K = (typeof KONF !== 'undefined' && KONF.arsip) || {};
      if (fn === 'simpanArsip') { const c = K[a[0]], v = a[1].v || {}; const isi = Object.values(v).filter(x => x).slice(0, 2).join(' · '); return (c ? c.judul : a[0]) + ': ' + isi; }
      if (fn === 'simpanData') return (a[1] === 'Data_BPD' ? 'Data BPD' : 'Data Perangkat') + ': ' + a[0].nama + ' (' + a[0].jabatan + ')';
      if (fn === 'simpanLayananData') return (a[1] === 'Permintaan' ? 'Layanan Kilat' : 'Balasan Layanan Kilat') + ': ' + a[0].jenis;
      if (fn === 'tandaiDibaca') return 'Tanda sudah dibaca';
      if (fn === 'simpanFotoSaya') return 'Foto / logo profil';
    } catch (e) { }
    return fn;
  }
  async function tulis(fn, a) {
    const it = { qid: uuid(), fn, args: a, user: aktif, label: labelItem(fn, a), dibuat: Date.now(), status: 'menunggu', error: '' };
    await qPut(it); perbaruiStatus();
    if (!offline || Date.now() > lewatiJaringanSampai) {
      const h = await kirimSatu(it);
      if (h.terkirim) { toast('✓ Terkirim ke server', 'success', 1800); return h.hasil; }
      if (h.ditolak) { await qDel(it.qid); perbaruiStatus(); return h.hasil; }  // ditolak saat itu juga: tampilkan pesannya, tidak disimpan
    }
    return fn === 'tandaiDibaca' ? { status: 'sukses' } : { status: 'sukses', offline: true };
  }

  async function kirimSatu(it) {
    it.status = 'mengirim'; await qPut(it); perbaruiStatus();
    try {
      const r = await panggilServer(it.fn, it.args, it.qid, it.user, 180000);
      if (r && r.status && r.status !== 'sukses' && it.fn !== 'tandaiDibaca') {
        it.status = 'ditolak'; it.error = r.error || 'Ditolak server'; await qPut(it); return { ditolak: true, hasil: r };
      }
      await qDel(it.qid);
      if (it.user === aktif) segarkan(TERKAIT[it.fn] || []);
      return { terkirim: true, hasil: r };
    } catch (e) {
      if (e.isJaringan) { it.status = 'menunggu'; await qPut(it); tandaiOffline(true); return { jaringan: true }; }
      if (e.perluLogin) { it.status = 'menunggu'; await qPut(it); return { perluLogin: true }; }
      it.status = 'ditolak'; it.error = e.message; await qPut(it); return { ditolak: true, hasil: { status: 'gagal', error: e.message } };
    } finally { perbaruiStatus(); }
  }

  let sinkronJalan = false, baruTerkirim = 0;
  async function sinkron(paksa) {
    if (sinkronJalan || !navigator.onLine) return;
    sinkronJalan = true;
    let terkirim = 0, ditolak = 0;
    try {
      const daftar = (await qAll()).filter(x => x.status === 'menunggu' || x.status === 'mengirim' || (paksa && x.status === 'ditolak')).sort((a, b) => a.dibuat - b.dibuat);
      for (const it of daftar) {
        const h = await kirimSatu(it);
        if (h.jaringan || h.perluLogin) break;
        if (h.terkirim && it.fn !== 'tandaiDibaca') terkirim++;
        if (h.ditolak) ditolak++;
      }
    } finally { sinkronJalan = false; }
    if (terkirim) {
      baruTerkirim = Date.now(); perbaruiStatus();
      toast('✓ ' + terkirim + ' data berhasil terkirim ke server', 'success', 3500);
      muatUlangHalaman();
    }
    if (ditolak) toast(ditolak + ' data ditolak server. Ketuk bar status untuk melihat alasannya.', 'error', 5000);
  }
  function muatUlangHalaman() {
    try {
      const modalBuka = document.getElementById('modalOverlay') && !document.getElementById('modalOverlay').classList.contains('hidden-section');
      const diApp = document.getElementById('appScreen') && !document.getElementById('appScreen').classList.contains('hidden-section');
      if (diApp && !modalBuka && typeof showPage === 'function' && typeof halAktif !== 'undefined') showPage(halAktif);
    } catch (e) { }
  }

  async function onlineSaja(fn, a) {
    if (offline && Date.now() < lewatiJaringanSampai) throw new Error('Fitur ini membutuhkan koneksi internet. Coba lagi saat ada sinyal.');
    try {
      const r = await panggilServer(fn, a, null, null, 120000);
      if ((fn === 'simpanLatar' || fn === 'resetLatar') && r && r.status === 'sukses') await kvSet('latar', { url: r.url || '' });
      if ((fn === 'gantiPasswordAwal' || fn === 'gantiPasswordSaya') && r && r.status === 'sukses') {
        const au = await authDari(aktif), baru = fn === 'gantiPasswordAwal' ? a[0] : a[1];
        if (au) { const h = await hashPw(String(baru).trim()); au.salt = h.salt; au.hash = h.hash; delete au.profil.wajibGanti; await kvSet(kunciAuth(au.username), au); }
      }
      return r;
    } catch (e) { if (e.isJaringan) throw new Error('Fitur ini membutuhkan koneksi internet. Coba lagi saat ada sinyal.'); throw e; }
  }

  // ---------------------------------------------------------------- pengganti google.script.run
  async function jalankan(fn, args) {
    if (fn === 'loginUser') return masuk(args[0], args[1]);
    if (fn === 'getLatar') {   // latar belakang: tidak perlu login, disimpan di perangkat agar tampil saat offline
      try { const j = await kirimApi({ aksi: 'latar' }, 15000); const r = (j && j.hasil) || { url: '' }; await kvSet('latar', r); return r; }
      catch (e) { return (await kvGet('latar')) || { url: '' }; }
    }
    if (fn === 'logoutUser') {
      const sisa = (await qAll()).filter(x => x.user === aktif && x.status !== 'ditolak' && x.fn !== 'tandaiDibaca').length;
      if (sisa) setTimeout(() => toast(sisa + ' data masih menunggu dikirim. Data aman di perangkat dan akan terkirim saat aplikasi dibuka dan ada sinyal.', 'warning', 6000), 600);
      return { status: 'sukses' };
    }
    const a = args.slice(1);  // token dari tampilan tidak dipakai: server memakai kunci perangkat
    if (BACA.has(fn)) return baca(fn, a);
    if (TULIS.has(fn)) return tulis(fn, a);
    if (ONLINE_SAJA.has(fn)) return onlineSaja(fn, a);
    throw new Error('Fungsi tidak dikenal: ' + fn);
  }
  function runner() {
    let ok = () => { }, gagal = e => console.error(e);
    const o = new Proxy({}, {
      get(t, k) {
        if (k === 'withSuccessHandler') return f => { ok = f; return o; };
        if (k === 'withFailureHandler') return f => { gagal = f; return o; };
        if (k === 'withUserObject') return () => o;
        return (...args) => { jalankan(String(k), args).then(r => ok(r), e => gagal(e instanceof Error ? e : new Error(String(e)))); };
      }
    });
    return o;
  }
  window.google = { script: { get run() { return runner(); }, host: { close() { } } } };
  window.SILAT_OFFLINE = { sinkron, antrian: qAll };

  // ---------------------------------------------------------------- tampilan status & antrian
  // Pemberitahuan kecil sendiri (tidak menimpa kotak dialog aplikasi)
  let wadahToast = null;
  function toast(teks, jenis, ms) {
    if (!document.body) return;
    if (!wadahToast) {
      wadahToast = document.createElement('div');
      wadahToast.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100001;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;width:max-content;max-width:calc(100vw - 24px)';
      document.body.appendChild(wadahToast);
    }
    const warna = { success: '#15803d', warning: '#b45309', error: '#b91c1c', info: '#1f2937' }[jenis] || '#1f2937';
    const t = document.createElement('div');
    t.style.cssText = 'background:' + warna + ';color:#fff;font:600 13px Inter,system-ui,sans-serif;padding:10px 16px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.28);opacity:0;transform:translateY(-8px);transition:all .25s;text-align:center';
    t.textContent = teks;
    wadahToast.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'none'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, ms || 2500);
  }
  let bar = null;
  function pasangBar() {
    if (bar || !document.body) return;
    bar = document.createElement('button');
    bar.id = 'bar-sinkron';
    bar.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99990;display:none;align-items:center;gap:8px;border:0;border-radius:999px;padding:9px 14px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;max-width:calc(100vw - 28px)';
    bar.onclick = bukaPanel;
    document.body.appendChild(bar);
    perbaruiStatus();
  }
  let jadwalStatus = null;
  function perbaruiStatus() { clearTimeout(jadwalStatus); jadwalStatus = setTimeout(gambarStatus, 80); }
  async function gambarStatus() {
    if (!bar) return;
    const q = (await qAll()).filter(x => x.fn !== 'tandaiDibaca' && (!aktif || x.user === aktif));
    const tunggu_ = q.filter(x => x.status === 'menunggu').length, kirim = q.filter(x => x.status === 'mengirim').length, tolak = q.filter(x => x.status === 'ditolak').length;
    const diApp = document.getElementById('appScreen') && !document.getElementById('appScreen').classList.contains('hidden-section');
    let warna = '', teks = '', ikon = '';
    if (tolak) { warna = '#dc2626'; ikon = 'fa-triangle-exclamation'; teks = tolak + ' data gagal terkirim · ketuk'; }
    else if (perluLogin && (tunggu_ + kirim)) { warna = '#dc2626'; ikon = 'fa-right-to-bracket'; teks = 'Login ulang untuk mengirim ' + (tunggu_ + kirim) + ' data'; }
    else if (kirim) { warna = '#2563eb'; ikon = 'fa-spinner fa-spin'; teks = 'Mengirim ' + (kirim + tunggu_) + ' data…'; }
    else if (offline && tunggu_) { warna = '#d97706'; ikon = 'fa-cloud-arrow-up'; teks = 'Offline · ' + tunggu_ + ' data belum terkirim'; }
    else if (tunggu_) { warna = '#2563eb'; ikon = 'fa-clock'; teks = tunggu_ + ' data menunggu dikirim'; }
    else if (offline && diApp) { warna = '#4b5563'; ikon = 'fa-wifi'; teks = 'Offline · data disimpan di perangkat'; }
    else if (Date.now() - baruTerkirim < 5000) { warna = '#16a34a'; ikon = 'fa-circle-check'; teks = 'Semua data sudah terkirim'; setTimeout(perbaruiStatus, 5200); }
    if (!teks) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex'; bar.style.background = warna; bar.style.color = '#fff';
    bar.innerHTML = '<i class="fas ' + ikon + '"></i><span>' + teks + '</span>';
  }

  async function bukaPanel() {
    const q = (await qAll()).filter(x => x.fn !== 'tandaiDibaca' && (!aktif || x.user === aktif)).sort((a, b) => a.dibuat - b.dibuat);
    const esc_ = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const chip = s => s === 'ditolak' ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">Ditolak</span>'
      : (s === 'mengirim' ? '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">Mengirim</span>'
        : '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700">Belum terkirim</span>');
    const isi = q.length ? q.map(x => '<div style="text-align:left;border:1px solid #e5e7eb;border-radius:10px;padding:10px;margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:13px">' + esc_(x.label) + '</b>' + chip(x.status) + '</div>'
      + '<div style="font-size:11px;color:#6b7280;margin-top:3px">Disimpan ' + new Date(x.dibuat).toLocaleString('id-ID') + '</div>'
      + (x.error ? '<div style="font-size:12px;color:#b91c1c;margin-top:4px">Alasan: ' + esc_(x.error) + '</div>' : '')
      + '<div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end">'
      + (x.status === 'ditolak' ? '<button data-ulang="' + x.qid + '" style="font-size:12px;border:0;background:#2563eb;color:#fff;border-radius:6px;padding:4px 10px">Kirim ulang</button>' : '')
      + '<button data-hapus="' + x.qid + '" style="font-size:12px;border:0;background:#f3f4f6;color:#b91c1c;border-radius:6px;padding:4px 10px">Hapus</button></div></div>').join('')
      : '<p style="color:#16a34a;font-weight:600">✓ Semua data sudah terkirim.</p>';
    const status = offline ? '<p style="font-size:12px;color:#92400e;background:#fef3c7;padding:8px;border-radius:8px">Belum ada sinyal. Data aman di perangkat ini dan akan dikirim otomatis saat online.</p>' : '';
    Swal.fire({
      title: 'Antrian Kirim Data', width: 560,
      html: status + '<div style="max-height:55vh;overflow:auto">' + isi + '</div>',
      showCancelButton: true, confirmButtonText: '<i class="fas fa-paper-plane"></i> Kirim sekarang', cancelButtonText: 'Tutup', confirmButtonColor: '#15803d',
      didOpen: el => {
        el.querySelectorAll('[data-hapus]').forEach(b => b.onclick = async () => {
          const ok = await Swal.fire({ icon: 'warning', title: 'Hapus data ini dari antrian?', text: 'Data yang belum terkirim akan hilang dan harus diisi ulang.', showCancelButton: true, confirmButtonText: 'Ya, hapus', cancelButtonText: 'Batal', confirmButtonColor: '#dc2626' });
          if (ok.isConfirmed) { await qDel(b.dataset.hapus); perbaruiStatus(); muatUlangHalaman(); bukaPanel(); } else bukaPanel();
        });
        el.querySelectorAll('[data-ulang]').forEach(b => b.onclick = async () => {
          const it = (await qAll()).find(x => x.qid === b.dataset.ulang); if (it) { it.status = 'menunggu'; it.error = ''; await qPut(it); }
          Swal.close(); sinkron();
        });
      }
    }).then(r => { if (r.isConfirmed) { if (!navigator.onLine) toast('Belum ada sinyal internet.', 'warning'); else sinkron(true); } });
  }

  // ---------------------------------------------------------------- pemicu kirim otomatis
  window.addEventListener('online', () => { tandaiOffline(false); setTimeout(sinkron, 1500); });
  window.addEventListener('offline', () => tandaiOffline(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sinkron(); });
  setInterval(() => { if (navigator.onLine) sinkron(); perbaruiStatus(); }, 30000);
  window.addEventListener('beforeunload', e => {
    if (offline && bar && bar.style.display !== 'none' && /belum terkirim/.test(bar.textContent)) { e.preventDefault(); e.returnValue = ''; }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pasangBar); else pasangBar();
  setTimeout(sinkron, 3000);

  // ---------------------------------------------------------------- service worker (agar bisa dibuka tanpa sinyal)
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
})();
