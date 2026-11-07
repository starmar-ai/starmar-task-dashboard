# DESIGN.md: Starmar AI Task Dashboard

Arah desain untuk dashboard task manager Starmar AI. File ini isinya data desain (identitas, palet, tipografi, komponen, dial). antislop dipakai sebagai filter, file ini yang kasih arahnya.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

## Identitas

- **Produk:** task manager internal Starmar AI. Dipakai tiap hari oleh Fadli (admin), lalu tim (Alfarizi, Fauzi). Kerja dikelompokkan per project.
- **Kesan:** "bintang di langit malam". Profesional, modern, tapi tetap ceria. Rapi dan cepat dibaca, bukan ramai.
- **Prinsip utama:** fitur yang dipakai harian, tidak membingungkan. Satu fokus jelas per layar.
- **Bahasa UI:** Indonesia (default), bisa ganti ke Inggris di Settings. Nada santai tapi jelas, kalimat pendek.
- **Maskot:** astronot yang memegang bintang. Logo dan maskot belum dibuat, jadi pakai placeholder jujur sampai Fadli kasih aset (jangan bikin logo/ilustrasi sendiri).

## Gaya visual (motif identitas)

Gaya flat yang "playful tapi rapi", versi kita sendiri:

- **Outline tebal:** border 2px warna Midnight Indigo di kartu, tombol, input, chip, tab.
- **Shadow offset keras:** bayangan solid tanpa blur, geser ke kanan-bawah (contoh `4px 4px 0 #2B2A6B`). Ini motif utama. Pakai di elemen yang bisa diklik atau jadi fokus, bukan di semua hal.
- **Pill:** tombol, tab, chip status, dan filter berbentuk pill (radius penuh). Kartu pakai radius sedang (12px).
- **Warna flat cerah di atas Cream.** Gradient indigo ke ungu hanya opsional, untuk satu area spesial (misal header/empty state hero), tidak di mana-mana.
- **Interaksi:** saat hover, elemen naik sedikit dan shadow membesar; saat ditekan, elemen turun dan shadow hilang (efek "ditekan"). Ini satu-satunya gerakan dekoratif.

## Palet

| Token | Hex | Fungsi |
|---|---|---|
| `indigo` (Midnight Indigo) | `#2B2A6B` | Teks utama, outline, shadow, permukaan di tema gelap |
| `yellow` (Star Yellow) | `#FFD23F` | Aksen utama: tombol utama, highlight, item aktif |
| `coral` | `#FF6B57` | Urgent, telat (overdue), flag "Berisiko" |
| `teal` | `#2FA89A` | Selesai (Done), sukses |
| `periwinkle` | `#8FA8F0` | Sedang berjalan (In Progress), proses |
| `cream` | `#FAF6EC` | Latar tema terang, area konten |

Gradient opsional: indigo `#2B2A6B` ke ungu periwinkle.

**Satu aksen yang disengaja:** Star Yellow dipakai hemat untuk aksi utama di tiap layar. Coral hanya untuk hal yang memang butuh perhatian, bukan dekorasi.

### Pemetaan status dan prioritas

- **Status task:** To Do (netral, putih/cream dengan outline), In Progress (periwinkle), Review (yellow), Done (teal), Blocked otomatis (coral).
- **Prioritas:** Low (periwinkle), Medium (cream/netral), High (yellow), Urgent (coral).
- **Status project:** Perencanaan, Aktif, Ditunda, Selesai, plus flag otomatis "Berisiko" (coral).
- **Warna per project:** tiap project punya warna sendiri (dipakai di gantt, kalender, dan titik warna di nama project). Warna project harus selalu ditemani nama/label, jangan jadi satu-satunya penanda.

### Aturan kontras (sudah dicek dengan contrast checker antislop)

Teks normal butuh 4.5:1, komponen non-teks 3:1.

- Indigo di atas Cream: 11.8:1, aman.
- Indigo di atas Yellow: 8.8:1, aman (tombol utama = teks indigo di atas yellow).
- Indigo di atas Periwinkle: 5.5:1, aman.
- Indigo di atas Coral: 4.55:1, pas lolos. Chip coral pakai teks indigo tebal.
- **Teks putih di atas Coral (2.8:1) dan Teal (2.9:1) GAGAL.** Jangan pakai teks putih di dua warna ini.
- **Indigo di atas Teal 4.37:1 GAGAL** untuk teks normal. Untuk chip "Selesai" pakai teal muda `#5DBDB0` (5.7:1 dengan indigo) sebagai latar, atau teal penuh hanya sebagai ikon/garis.
- **Coral dan Teal sebagai warna teks di atas Cream gagal** (2.6:1 dan 2.7:1). Pakai sebagai latar chip atau ikon, teksnya tetap indigo. Karena semua chip punya outline indigo 2px, batas komponennya tetap terlihat.
- Teks sekunder di tema terang: `#5B5A8C` di atas Cream (5.9:1).

## Tema

- **Terang (default):** latar Cream, kartu putih/cream, outline dan shadow indigo.
- **Gelap (toggle):** tiga tingkat indigo. Panel utama paling gelap `#1A1944`, kartu dan tabel satu tingkat di atasnya `#252462`, input dan area dalam kartu satu tingkat lagi `#2E2D74`. Sidebar `#2B2A6B`, lebih terang dari panel supaya terbaca sebagai area sendiri. Teks Cream (15.4:1 di panel, 12.9:1 di kartu, 11.2:1 di input). Outline dan shadow pakai lavender muda `#B8B6E0` supaya motif outline tetap kelihatan. Yellow tetap jadi aksen utama; teks di atas Yellow dan Coral tetap indigo.
- Pilihan tema disimpan per user.

## Tipografi

- Satu keluarga sans-serif yang bulat dan ramah, tebal untuk judul (contoh kandidat: Plus Jakarta Sans atau Nunito; final dipilih saat build).
- Hierarki: judul halaman tebal dan besar, judul kartu semi-bold, isi regular. Angka penting (jumlah task, overdue) besar dan tebal.
- Tanpa teks huruf kapital semua di paragraf; huruf kapital hanya untuk label kecil kalau perlu.

## Layout

- **Navigasi:** sidebar kiri (Dashboard, Projects, Tasks, Calendar, filter favorit yang disimpan, Settings). Di mobile jadi menu yang bisa dibuka-tutup.
- **Halaman inti:** Projects (tabel + gantt), Tasks per project (tabel, kanban, gantt), Calendar (semua project, warna per project), Dashboard (jumlah task yang harus selesai, filter project dan periode).
- **Satu fokus per layar:** contoh di Dashboard, angka "task yang harus selesai" plus overdue jadi fokus; sisanya mengikuti.
- **Kepadatan:** ini alat kerja harian, jadi tabel dan kanban boleh padat, tapi beri ruang kosong yang konsisten antar bagian.
- Pencarian cepat (`/` atau Ctrl+K) selalu bisa diakses dari header.

## Komponen (gaya)

- **Tombol utama:** pill yellow, teks indigo, outline + shadow offset.
- **Tombol sekunder:** pill putih/cream, outline indigo, tanpa isi warna.
- **Chip status/prioritas:** pill kecil, warna sesuai pemetaan di atas, outline indigo, ikon + teks (jangan hanya warna).
- **Kartu:** latar putih/cream, outline 2px, radius 12px, shadow offset hanya kalau bisa diklik.
- **Tab/segmented control** (Tabel/Kanban/Gantt): pill, tab aktif berisi yellow.
- **Today line** di gantt dan kalender: garis coral tipis dengan label "Hari ini".

## Gerak (MOTION 1)

- Hanya state hover/pressed/focus dan transisi singkat (di bawah 200ms) saat buka panel atau modal.
- Tidak ada animasi loop, parallax, atau animasi masuk besar. Hormati `prefers-reduced-motion`.

## Yang dihindari

- Stat atau angka palsu, testimoni palsu, logo/ilustrasi yang dibuat tanpa persetujuan.
- Gradient, glow, atau efek kaca di semua tempat. Motif kita adalah outline + shadow keras, bukan blur.
- Semua bagian dengan pola sama (judul tengah + grid kartu identik).
