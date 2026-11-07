# Starmar AI Task Dashboard

Task manager internal Starmar AI. Stack: React (Vite + TypeScript) di depan, Supabase (Postgres + login) di belakang, hosting di Vercel. Semua pakai paket gratis.

Status sekarang: **Tahap 6 bagian 1 (akses tim)**. Tahap 1 berisi login undangan, role Admin/Member, tabel Proyek dan Tugas, tambah/ubah/hapus tugas, label, tema terang/gelap, bahasa Indonesia/Inggris, dan zona waktu (default WIB). Tahap 2 menambah Dashboard sebagai halaman pertama setelah login: jumlah tugas yang harus selesai (telat dipisah), filter proyek dan periode (hari ini, 7 hari, 1 bulan, pilih tanggal), Fokus hari ini, Perlu perhatian, grafik per proyek yang bisa diklik, dan Rincian. Tahap 2 tidak butuh perubahan database.

Tahap 3 (Tugas per proyek): halaman Tugas bisa dilihat sebagai **Tabel** atau **Kanban** (kolom To Do, In Progress, Review, Done). Kartu bisa digeser antar kolom, atau statusnya diganti lewat pilihan di kartu (cara ini juga jalan di HP dan keyboard). Klik nama proyek di halaman Proyek untuk membuka tugas proyek itu. Tugas bisa **menunggu tugas lain** (A harus selesai sebelum B): selama yang ditunggu belum Done, tugasnya otomatis **Blocked**, dan otomatis lepas begitu semuanya Done. Tanggal tidak digeser otomatis. Tugas yang punya **reviewer** hanya bisa jadi Done lewat reviewer (atau admin): reviewer klik **Setujui**, atau **Tolak** dengan catatan, lalu tugas balik ke In Progress dan catatannya tampil di tugas.

## Update: Tahap 6 bagian 1 (akses tim)

Admin bisa mengundang anggota dari halaman **Tim**, mengatur proyek mana yang boleh dilihat tiap orang, mengganti role, dan mencabut atau memulihkan akses. Langkah setup (sekali saja):

1. Supabase > **SQL Editor** > **New query**. Copy semua isi `supabase/migrations/20261107120000_stage6_team_access.sql`, paste, **Run**. Harus muncul "Success. No rows returned". Aman kalau tidak sengaja dijalankan dua kali.
2. Supabase > **Project Settings** > **API Keys**. Salin **service_role** key (atau **secret key**). Ini kunci rahasia: jangan dibagi ke siapa pun dan jangan diberi awalan `VITE_`.
3. Vercel > project > **Settings** > **Environment Variables**. Tambah `SUPABASE_SERVICE_ROLE_KEY` = kunci tadi, centang **Production** dan **Preview**, Save. Lalu **Deployments** > titik tiga di deploy teratas > **Redeploy**.
4. Supabase > **Authentication** > **URL Configuration** > **Redirect URLs** > **Add URL**: `https://starmar-task-dashboard.vercel.app/**` dan `https://starmar-task-dashboard-*-starmar.vercel.app/**` (yang kedua untuk link preview).
5. Pastikan **Authentication** > **Sign In / Providers** > **Email** > **Allow new users to sign up** tetap **mati**. Kalau pun ada yang daftar sendiri, akunnya tidak aktif sampai admin memulihkan aksesnya.
6. Opsional: di halaman yang sama, ubah **Email OTP Expiration** jadi `86400` supaya link undangan berlaku 24 jam (bawaannya 1 jam).

Link undangan bisa dikirim lewat WhatsApp (tombol **Buat link undangan**). Tombol **Kirim lewat email** pakai email bawaan Supabase, yang di plan gratis dibatasi beberapa email per jam dan bisa saja hanya terkirim ke email anggota tim Supabase kamu sendiri sampai SMTP sendiri (misalnya Resend) dipasang.

Tes aturan akses database: `tests/sql/run.sh` (butuh Postgres lokal).

## Update database: Tahap 3 (menunggu tugas lain + review)

Jalankan sekali saja, setelah update komentar/link/file di bawah sudah pernah dijalankan:

1. Buka Supabase > project kamu > **SQL Editor** > **New query**.
2. Copy semua isi file `supabase/migrations/20261107060000_stage3_dependencies_review.sql`, paste, lalu klik **Run**. Harus muncul "Success. No rows returned".
3. Cek di **Table Editor**: harus ada tabel baru `task_dependencies`.

## Update database: Trash untuk tugas

Hapus tugas sekarang masuk ke halaman **Trash** (bisa dipulihkan, otomatis dihapus permanen setelah 30 hari). Jalankan sekali saja, setelah update-update database sebelumnya:

1. Buka Supabase > project kamu > **SQL Editor** > **New query**.
2. Copy semua isi file `supabase/migrations/20261107140000_task_trash.sql`, paste, lalu klik **Run**. Harus muncul "Success. No rows returned".

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
| `tests` | Tes hitungan Dashboard dan aturan status/menunggu tugas (`npm test`) |
| `supabase/migrations` | Skema database + aturan akses (row level security) |
| `api/team.ts` | Fungsi server (Vercel) untuk undangan dan cabut akses; satu-satunya tempat kunci rahasia Supabase dipakai |
| `DESIGN.md` | Arah desain (palet, gaya, dial) |

## Aturan akses (dijaga di database)

- Akun pertama yang dibuat otomatis jadi **Admin**. Akun berikutnya jadi **Member**.
- Daftar sendiri dimatikan. Akun hanya dibuat oleh admin.
- Admin: lihat dan ubah semua. Membuat, mengubah, menghapus proyek.
- Member: hanya lihat proyek tempat dia jadi PM atau anggota. Bisa bikin tugas di proyek itu. Hanya bisa ubah/hapus tugas yang dia buat atau yang ditugaskan ke dia.
- Assignee dan reviewer harus orang yang punya akses ke proyek tugas itu.
- Reviewer hanya bisa diganti oleh pembuat tugas atau admin, jadi yang mengerjakan tidak bisa melewati review.
- Role dan status akses tidak bisa diubah sendiri, dan admin terakhir tidak bisa diturunkan.
- Akun yang aksesnya dicabut (atau yang masuk tanpa undangan) tidak bisa melihat atau mengubah apa pun, dan tidak bisa login.

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

### Menambah anggota

Di aplikasi: **Tim** > **Undang anggota**. Isi email, centang proyeknya, klik **Buat link undangan**, lalu kirim linknya. Orangnya buka link, bikin password, dan langsung masuk.

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
