# Starmar AI Task Dashboard

Task manager internal Starmar AI. Stack: React (Vite + TypeScript) di depan, Supabase (Postgres + login) di belakang, hosting di Vercel. Semua pakai paket gratis.

Status sekarang: **Tahap 2 (Dashboard)**. Tahap 1 berisi login undangan, role Admin/Member, tabel Proyek dan Tugas, tambah/ubah/hapus tugas, label, tema terang/gelap, bahasa Indonesia/Inggris, dan zona waktu (default WIB). Tahap 2 menambah Dashboard sebagai halaman pertama setelah login: jumlah tugas yang harus selesai (telat dipisah), filter proyek dan periode (hari ini, 7 hari, 1 bulan, pilih tanggal), Fokus hari ini, Perlu perhatian, grafik per proyek yang bisa diklik, dan Rincian. Tahap 2 tidak butuh perubahan database.

## Update database: komentar, link, dan file di tugas

Fitur ini butuh tabel baru dan tempat simpan file di Supabase. Jalankan sekali saja:

1. Buka Supabase > project kamu > **SQL Editor** > **New query**.
2. Copy semua isi file `supabase/migrations/20261107040000_task_comments_links_files.sql`, paste, lalu klik **Run**. Harus muncul "Success. No rows returned".
3. Cek di menu **Storage**: harus ada bucket `task-files` (Private).

Aturannya: semua orang yang bisa lihat tugas boleh komentar, tambah link, dan upload file. Yang boleh hapus link/file: yang menambahkan, pemilik tugas (assignee atau pembuat), atau admin. Komentar hanya bisa dihapus penulisnya atau admin. File maksimal 5 MB, dicek di aplikasi dan di Supabase. Kuota penyimpanan paket gratis Supabase 1 GB untuk semua file.

## Struktur

| Folder / file | Isi |
|---|---|
| `src/pages` | Halaman: Dashboard, Tugas, Proyek, Pengaturan, Login, Buat password |
| `src/components` | Sidebar, modal, chip status/prioritas, tampilan kosong/loading/error |
| `src/lib` | Koneksi Supabase, teks UI (ID/EN), tipe data, tanggal, hitungan Dashboard |
| `tests` | Tes hitungan Dashboard (`npm test`) |
| `supabase/migrations` | Skema database + aturan akses (row level security) |
| `DESIGN.md` | Arah desain (palet, gaya, dial) |

## Aturan akses (dijaga di database)

- Akun pertama yang dibuat otomatis jadi **Admin**. Akun berikutnya jadi **Member**.
- Daftar sendiri dimatikan. Akun hanya dibuat oleh admin.
- Admin: lihat dan ubah semua. Membuat, mengubah, menghapus proyek.
- Member: hanya lihat proyek tempat dia jadi PM atau anggota. Bisa bikin tugas di proyek itu. Hanya bisa ubah/hapus tugas yang dia buat atau yang ditugaskan ke dia.
- Role tidak bisa diubah sendiri, dan admin terakhir tidak bisa diturunkan.

## Setup pertama kali (sekali saja)

### 1. Supabase (database + login)

1. Buka https://supabase.com, daftar pakai akun GitHub.
2. Klik **New project**. Isi nama `starmar-task-dashboard`, buat password database (simpan baik-baik), region **Southeast Asia (Singapore)**, plan **Free**.
3. Tunggu sampai project siap (1 sampai 2 menit).
4. Buka menu **SQL Editor** > **New query**. Copy semua isi file `supabase/migrations/20261106180000_stage1_foundation.sql`, paste, lalu klik **Run**. Harus muncul "Success".
5. Buka **Authentication** > **Sign In / Providers** > **Email**. Matikan **Allow new users to sign up**, lalu Save. (Ini yang bikin login cuma lewat undangan.)
6. Buka **Authentication** > **Users** > **Add user** > **Create new user**. Isi email dan password kamu, centang **Auto Confirm User**. Akun pertama ini otomatis jadi Admin.
7. Buka **Project Settings** > **API Keys** (atau **Data API**). Catat dua nilai: **Project URL** dan **anon / publishable key**.

### 2. Vercel (hosting)

1. Buka https://vercel.com, daftar pakai akun GitHub (plan **Hobby**, gratis).
2. Klik **Add New** > **Project**, pilih repo `starmar-ai/starmar-task-dashboard`, klik **Import**.
3. Framework otomatis terbaca **Vite**. Buka **Environment Variables**, tambahkan:
   - `VITE_SUPABASE_URL` = Project URL dari Supabase
   - `VITE_SUPABASE_ANON_KEY` = anon / publishable key dari Supabase
4. Klik **Deploy**. Setelah selesai, Vercel kasih link seperti `https://starmar-task-dashboard.vercel.app`.
5. Balik ke Supabase > **Authentication** > **URL Configuration**. Isi **Site URL** dengan link Vercel tadi, lalu Save. (Supaya link reset password dan undangan mengarah ke aplikasi.)

Buka link Vercel, masuk dengan email dan password dari langkah 1.6.

### Menambah anggota (sementara, sebelum Tahap 6)

Supabase > **Authentication** > **Users** > **Add user** > **Create new user**, centang **Auto Confirm User**, lalu kasih email dan password ke orangnya. Setelah itu di aplikasi, buka **Proyek** > **Ubah**, centang namanya di **Anggota** supaya dia bisa lihat proyek itu.

Email undangan dan reset password dari Supabase gratisan dibatasi beberapa email per jam. Email yang lancar (pakai Resend) dipasang di Tahap 6.

## Jalankan di laptop (untuk developer)

Butuh Node.js 20+ dan Docker.

```bash
npm install
npx supabase start          # database lokal + login, migrasi otomatis jalan
cp .env.example .env.local  # isi dengan API URL dan publishable key dari output supabase start
npm run dev                 # buka http://localhost:5173
```

Buat akun lokal pertama lewat Supabase Studio lokal (`http://127.0.0.1:54323`) > Authentication > Add user.

Cek sebelum push: `npm test` (hitungan Dashboard) dan `npm run build` (typecheck + build).
