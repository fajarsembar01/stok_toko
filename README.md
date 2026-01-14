# WhatsApp Bot -> Google Sheet

Bot WhatsApp gratis 100% (Baileys) untuk menambahkan data ke Google Sheet.

## Fitur
- Login via QR WhatsApp Web
- Catat transaksi masuk/keluar barang + harga
- Catat barang rusak (tanpa tagihan modal)
- Append otomatis ke Google Sheet
- Summary stok, omzet, dan profit
- Web dashboard CRUD barang (pakai PostgreSQL)
- Parser kalimat sederhana gratis (opsional AI lokal)
- Utang modal (bayar setelah barang terjual)

## Kebutuhan
- Node.js 18+
- Akun Google (untuk service account)

## Setup Google Sheet
1. Buat project di Google Cloud Console
2. Enable **Google Sheets API**
3. Buat **Service Account**, download JSON
4. Simpan JSON di folder project (contoh: `service-account.json`)
5. Share Google Sheet ke email service account (role: Editor)

## Konfigurasi
1. Salin `.env.example` menjadi `.env`
2. Isi:
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SHEET_NAME`
   - `GOOGLE_SERVICE_ACCOUNT_FILE`
   - `SUMMARY_SHEET_NAME` (opsional)
   - `DATABASE_URL` (opsional PostgreSQL)
   - `WEB_PORT` (opsional dashboard, default 3333)
   - `WEB_ADMIN_USER` + `WEB_ADMIN_PASSWORD` + `WEB_SESSION_SECRET` (login dashboard)

## Struktur Sheet
Bot akan membuat 2 tab jika belum ada:
- `Transactions`: Timestamp, Type, Item, Qty, UnitPrice, Total, Note, Sender, Raw, SellPrice
- `Summary`: ringkasan otomatis per item

## Format pesan
```
!in Beras 5kg, 2, 60000, 75000
!out Beras 5kg, 1
!damage Beras 5kg, 1
!stock Beras 5kg
ai tissu masuk 10 buah harga beli 2000 harga jual 3000
ai tissu terjual 1
ai tissu rusak 1
bayar modal 50000
```

## Menjalankan
```
npm install
npm start
```
Scan QR di terminal, atau buka file `qr.png`, lalu kirim pesan sesuai format.

## Web dashboard (CRUD stok)
Pastikan `DATABASE_URL` sudah diisi, lalu jalankan:
```
npm run web
```
Buka `http://localhost:3333` untuk kelola produk, harga, dan status aktif.
Login via `http://localhost:3333/login`.
Login default bisa diatur lewat `.env`:
```
WEB_ADMIN_USER=admin
WEB_ADMIN_PASSWORD=...
WEB_SESSION_SECRET=...
```

## Command
- `!in barang, qty, harga_beli[, harga_jual, catatan]`
- `!out barang, qty[, harga_jual, catatan]`
- `!damage barang, qty`
- `!stock barang`
- `ai barang masuk qty harga beli X harga jual Y`
- `ai barang terjual qty`
- `ai barang rusak qty`
- `bayar modal 50000`

## Catatan
- Grup nonaktif secara default. Set `ALLOW_GROUPS=true` jika perlu.
- Jika hanya punya 1 akun, set `ALLOW_SELF=true` dan kirim ke chat "Message Yourself".
- Data disimpan ke range `GOOGLE_SHEET_RANGE` (default `Transactions!A:J`).
- Harga jual default diambil dari terakhir kali kamu set `harga jual`. Jika belum ada, bot akan minta kamu set dulu.
- Jika harga jual sudah terset, perintah jual bisa tanpa harga (contoh `ai tissu terjual 1`).
- Perintah `bayar modal` akan mengurangi utang modal berdasarkan barang terjual (pakai harga beli terakhir). Kelebihan bayar jadi kredit.

## PostgreSQL (opsional)
Jika ingin simpan data di PostgreSQL lalu tetap sinkron ke Google Sheet:
```
DATABASE_URL=postgres://user:pass@host:5432/dbname
DB_TABLE=transactions
PRODUCTS_TABLE=products
DB_SUMMARY_VIEW=inventory_summary
PG_SSL=false
```
Jika `DATABASE_URL` kosong, bot hanya pakai Google Sheet.

Struktur DB yang dibuat otomatis:
- `products`: master barang (harga default, status aktif, catatan)
- `transactions`: transaksi masuk/keluar (link ke produk)
- `inventory_summary`: view ringkasan stok/omzet/profit
- `payable_entries`, `payable_payments`, `payable_allocations`: catatan utang modal + pembayaran
- `audit_logs`: log CRUD dari dashboard web

## AI opsional (gratis)
Default: parser sederhana (tanpa AI).

Pilihan AI gratis:
- **Gemini (cloud, free tier)**  
  Set di `.env`:
  ```
  AI_PROVIDER=gemini
  GEMINI_API_KEY=...
  GEMINI_MODEL=gemini-1.5-flash
  ```
- **Groq (cloud, free tier)**  
  Set di `.env`:
  ```
  AI_PROVIDER=groq
  GROQ_API_KEY=...
  GROQ_MODEL=llama-3.1-8b-instant
  ```
- **Ollama lokal** (tanpa API key, tapi butuh resource mesin)  
  Set di `.env`:
  ```
  AI_PROVIDER=ollama
  OLLAMA_MODEL=llama3.2
  ```

Jika tidak di-set, bot tetap jalan dengan parser sederhana.
