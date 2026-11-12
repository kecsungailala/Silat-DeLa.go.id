# SILAT-DeLa — Paket GitHub (bisa offline)

Sistem Layanan Terpadu Desa Se-Kecamatan Sungai Lala · Kabupaten Indragiri Hulu

Aplikasi di GitHub sekarang **langsung memakai tampilan SILAT-DeLa** (tidak lagi lewat bingkai Google), sehingga:
- bisa dipakai **tanpa sinyal**: data disimpan di HP/laptop lalu **terkirim otomatis** saat ada sinyal;
- tulisan Google "Aplikasi ini dibuat oleh pengguna Google Apps Script" **tidak muncul lagi**.

Data tetap di **spreadsheet yang sama**.

## Isi paket (semua file di satu folder)

| File | Fungsi |
|---|---|
| `index.html` | Layar pembuka (video) → ketuk → masuk ke aplikasi |
| `app.html` | Tampilan aplikasi. **Isinya sama persis dengan `index.html` di Apps Script** |
| `offline.js` | Mesin offline. Link /exec aplikasi sudah terisi di baris `const API = ...` |
| `sw.js` | Menyimpan tampilan & pustaka di perangkat agar bisa dibuka tanpa sinyal |
| `manifest.webmanifest`, `icon-*.png`, `maskable-*.png`, `apple-touch-icon.png`, `favicon.ico` | Nama & ikon saat aplikasi di-install |
| `intro.mp4`, `loading.mp4`, `intro-poster.jpg`, `logo-kecamatan-cincin.png` | Video pembuka & loading |

> ⚠️ Jangan upload `Code.gs` ke GitHub (berisi token Fonnte & ID spreadsheet).

## Langkah pasang

1. **Cadangkan spreadsheet**: File → Buat salinan.
2. **Apps Script**: ganti `Code.gs` dan `index.html` dengan versi baru → jalankan fungsi `_SETUP_DAN_CEK` sekali (membuat sheet `Absen_Bulanan`, `Perangkat_Offline`, `Sinkron_Log`).
3. **Deploy**: Terapkan → Kelola deployment → ✏️ Edit → **Versi baru** → Terapkan. Pastikan *Jalankan sebagai: Saya* dan *Akses: Siapa saja*. Link /exec tetap sama.
4. **GitHub**: hapus semua file lama di repository, lalu upload **semua file paket ini** (pilih semua → tarik ke halaman Upload files) → Commit changes.
5. Buka link GitHub, tekan **Ctrl + F5**. Di HP: tutup aplikasi lalu buka lagi (atau hapus & pasang ulang ikonnya agar nama & ikon baru muncul).

## Cara kerja offline untuk admin desa / BPD

- **Login sekali saat online** di setiap perangkat (HP dan laptop masing-masing). Setelah itu semua menu tersimpan di perangkat.
- Saat tidak ada sinyal: tetap bisa login, melihat data, menambah/mengedit data, dan membalas Layanan Kilat.
- Data yang belum terkirim diberi tanda **"Belum terkirim"**, dan bar di kanan bawah menunjukkan jumlahnya. Ketuk bar untuk melihat daftar antrian.
- Begitu ada sinyal, data **terkirim otomatis** dan muncul pemberitahuan **"✓ … data berhasil terkirim"**.
- Izin offline berlaku **60 hari** sejak terakhir online (diperpanjang otomatis). Harus login ulang saat online bila: ganti browser, data browser dihapus, 60 hari tidak online, atau password diganti/di-reset.
- Yang tetap butuh internet: membuka lampiran lama dari Drive, cetak dengan lampiran, hapus data, ganti password, dan menu khusus Admin Kecamatan.

## Bila nanti ada pembaruan

| Yang diubah | Yang dilakukan |
|---|---|
| `index.html` di Apps Script | Deploy versi baru, **lalu upload file yang sama ke GitHub dengan nama `app.html`**, dan naikkan versi di `sw.js` (`silat-dela-v1` → `silat-dela-v2`) |
| `Code.gs` saja | Deploy versi baru. GitHub tidak perlu diubah |
| Video / ikon / tampilan pembuka | Upload file pengganti ke GitHub dan naikkan versi di `sw.js` |

## Mencabut akses perangkat yang hilang

Buka sheet **Perangkat_Offline** → cari baris username tersebut → ubah kolom **Status** dari `Aktif` menjadi `Dicabut`. Atau cukup reset password akun itu: semua perangkatnya otomatis harus login ulang.
