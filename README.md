# scraping-judul-skripsi

## Konfigurasi `.env`

Buat file `.env` di root project dengan isi seperti berikut:

```env
MIKA_TOKEN=
PORT=5123
URL=https://mika.mikroskil.ac.id/mika/api/v1/TA-pengajuan-tugas-akhir-detail
```

- `MIKA_TOKEN`: Kunci API untuk autentikasi.
- `URL`: URL endpoint API MIKA yang digunakan.

## Cara Penggunaan API

1. Pastikan file `.env` sudah dikonfigurasi.
2. Jalankan aplikasi dengan perintah:

    ```bash
    npm run dev
    ```

## Contoh Endpoint

Berikut contoh request ke beberapa endpoint yang tersedia:

### 1. Ambil Data Skripsi

```bash
curl "http://localhost:5123/scrape?page=1&limit=5&offset=0&order_by[]=id_TA_proses_tugas_akhir|desc&order_by[]=mahasiswa.nim|desc"
```

### 2. Simpan Data ke CSV

```bash
curl "http://localhost:5123/scrape/save-csv?limit=200&offset=0"
```

### 3. Simpan Data ke CSV Otomatis

```bash
curl "http://localhost:5123/scrape/save-csv-auto?target=200&per_page=50&start_offset=0&delay=0"
```

## Catatan

- Jangan membagikan file `.env` ke publik.
- Pastikan API_KEY valid dan BASE_URL sesuai dokumentasi API.