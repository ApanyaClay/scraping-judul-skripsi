require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');

const app = express();
app.use(cors());
app.use(morgan('combined'));

// Folder untuk menyimpan file CSV hasil ekspor
const EXPORT_DIR = path.join(__dirname, 'exports');
if (!fs.existsSync(EXPORT_DIR)) fs.mkdirSync(EXPORT_DIR, { recursive: true });
// Serve statis agar file bisa diunduh via HTTP
app.use('/exports', express.static(EXPORT_DIR));

const URL = process.env.URL || 'https://mika.mikroskil.ac.id/mika/api/v1/TA-pengajuan-tugas-akhir-detail';
const TOKEN = process.env.MIKA_TOKEN || '';
const PORT = process.env.PORT || 5123;

/** Helper: build _next URL (untuk konsistensi output JSON) */
function buildNextUrl(baseUrl, { page = 1, limit = 5, offset = 0, order_by = [] }) {
  const nextOffset = Number(offset) + Number(limit);
  const qb = (order_by || []).map(v =>
    String(v).includes('|') || String(v).includes('%7C') ? v : `${v}|desc`
  );

  const params = new URLSearchParams();
  params.set('offset', String(nextOffset));
  params.set('limit', String(limit));
  params.set('/api/v1/TA-pengajuan-tugas-akhir-detail', '');
  params.set('page', String(page));
  qb.forEach(v => params.append('order_by[]', v));
  return `${baseUrl}?${params.toString()}`;
}

function cleanText(text) {
  if (!text) return null;
  return text.replace(/[\r\n]+/g, ' ').trim(); 
}

// Helper sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Helper: pemetaan item mentah -> struktur yang diminta */
function mapItem(raw = {}) {
  const mhs = raw.mahasiswa || {};
  const status =
    raw.status || raw.keterangan_status || raw.status_proses || raw.ket_status || null;

  const judulProdi =
    raw.judul_tugas_akhir_program_studi ||
    raw.judul_tugas_akhir ||
    raw.judul_usulan ||
    raw.judul ||
    null;

  const jenisJalur =
    raw.jenis_jalur || raw.jalur || raw.jenis_tugas_akhir || raw.program || null;

  return {
    nim: mhs.nim || raw.nim || null,
    nama: cleanText(mhs.nama || raw.nama || null),
    judul_indonesia: cleanText(
      raw.judul_indonesia || raw.judul_id || raw.judul_bahasa_indonesia || null
    ),
    judul_inggris: cleanText(
      raw.judul_inggris || raw.judul_en || raw.judul_bahasa_inggris || null
    ),
    status: cleanText(status),
    judul_tugas_akhir_program_studi: cleanText(judulProdi),
    jenis_jalur: cleanText(jenisJalur),
  };
}

/** Helper: request ke API MIKA */
async function fetchMika({ page = 1, limit = 5, offset = 0, order_by = [] } = {}) {
  const params = { page, limit, offset };
  // serialisasi order_by[] agar jadi query multiple
  (order_by || []).forEach((v, i) => (params[`order_by[${i}]`] = v));

  const headers = {};
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  const { data: raw } = await axios.get(URL, { params, headers });
  const rawData = raw?.data || raw?.results || raw?.items || [];
  const mapped = rawData.map(mapItem);
  const total =
    raw?._total ?? raw?.total ?? raw?.count ?? (Array.isArray(rawData) ? rawData.length : 0);

  return { data: mapped, total, raw };
}

/** Endpoint existing: transform dan tampilkan seperti contoh */
app.get('/scrape', async (req, res) => {
  try {
    const { page = '1', limit = '5', offset = '0' } = req.query;

    let order_by = req.query['order_by[]'];
    if (typeof order_by === 'string') order_by = [order_by];
    if (!Array.isArray(order_by) || order_by.length === 0) {
      order_by = ['id_TA_proses_tugas_akhir|desc', 'mahasiswa.nim|desc'];
    }

    const { data, total } = await fetchMika({ page, limit, offset, order_by });
    const nextUrl = buildNextUrl(URL, { page, limit, offset, order_by });

    return res.json({
      data,
      _total: total,
      _pagination: { _next: nextUrl },
    });
  } catch (err) {
    console.error('Scrape error:', err?.response?.status, err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({
      error: true,
      message:
        err?.response?.data?.message || err?.message || 'Terjadi kesalahan saat mengambil data.',
    });
  }
});

/**
 * Endpoint baru: /scrape/save-csv
 * - Mengambil 100 data (limit=100, offset=0, order_by default)
 * - Menyimpan ke file CSV di folder ./exports
 * - Mengembalikan info file & URL unduhan
 *
 * Anda juga bisa override via query:
 *   /scrape/save-csv?limit=200&offset=0
 */
app.get('/scrape/save-csv', async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    const offset = Number(req.query.offset ?? 0);
    const page = Number(req.query.page ?? 1);

    let order_by = req.query['order_by[]'];
    if (typeof order_by === 'string') order_by = [order_by];
    if (!Array.isArray(order_by) || order_by.length === 0) {
      order_by = ['id_TA_proses_tugas_akhir|desc', 'mahasiswa.nim|desc'];
    }

    // Ambil data dari MIKA
    const { data } = await fetchMika({ page, limit, offset, order_by });

    // Siapkan field CSV dalam urutan yang diinginkan
    const fields = [
      'nim',
      'nama',
      'judul_indonesia',
      'judul_inggris',
      'status',
      'judul_tugas_akhir_program_studi',
      'jenis_jalur',
    ];

    const parser = new Parser({ fields, withBOM: true }); // dengan BOM agar nyaman dibuka di Excel
    const csv = parser.parse(data);

    // Nama file: ta_<timestamp>.csv
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-') // aman untuk nama file
      .replace('T', '_')
      .replace('Z', '');
    const filename = `ta_${stamp}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);

    fs.writeFileSync(filepath, csv, 'utf8');

    // URL unduhan publik (karena kita serve /exports statis)
    const downloadUrl = `/exports/${filename}`;

    return res.json({
      saved: true,
      count: data.length,
      file: filename,
      download_url: downloadUrl,
      tip: 'Buka URL di atas di browser untuk mengunduh CSV.',
    });
  } catch (err) {
    console.error('Save CSV error:', err?.response?.status, err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({
      error: true,
      message:
        err?.response?.data?.message ||
        err?.message ||
        'Terjadi kesalahan saat menyimpan CSV.',
    });
  }
});

/**
 * Paginate otomatis:
 * Kumpulkan N baris (default 100) dengan loop offset+limit,
 * lalu simpan ke CSV. File disajikan via /exports agar mudah diunduh.
 *
 * Contoh:
 *  GET /scrape/save-csv-auto
 *  GET /scrape/save-csv-auto?target=200&per_page=50&start_offset=0
 *  GET /scrape/save-csv-auto?order_by[]=id_TA_proses_tugas_akhir|desc&order_by[]=mahasiswa.nim|desc
 */
app.get('/scrape/save-csv-auto', async (req, res) => {
  try {
    const target = Math.max(1, Number(req.query.target ?? 100));
    const perPage = Math.max(1, Number(req.query.per_page ?? 25));
    let offset = Math.max(0, Number(req.query.start_offset ?? 0));
    const page = 1; // tidak dipakai untuk paginate offset-based, biarkan 1 agar konsisten

    // Ambil order_by[] bila ada, kalau tidak pakai default sama seperti endpoint lain
    let order_by = req.query['order_by[]'];
    if (typeof order_by === 'string') order_by = [order_by];
    if (!Array.isArray(order_by) || order_by.length === 0) {
      order_by = ['id_TA_proses_tugas_akhir|desc', 'mahasiswa.nim|desc'];
    }

    const collected = [];
    const MAX_REQUESTS = 50; // pengaman agar tidak infinite loop
    let attempts = 0;

    while (collected.length < target && attempts < MAX_REQUESTS) {
      attempts += 1;

      const { data: batch } = await fetchMika({
        page,
        limit: perPage,
        offset,
        order_by,
      });

      if (!Array.isArray(batch) || batch.length === 0) {
        break; // tidak ada data lagi
      }

      // Tambahkan ke keranjang sampai memenuhi target
      for (const item of batch) {
        if (collected.length >= target) break;
        collected.push(item);
      }

      // Geser offset
      offset += perPage;

      // Delay sesuai permintaan sebelum request berikutnya
      await sleep(req.query.delay || 100);

      // Jika batch lebih kecil dari perPage, kemungkinan sudah di akhir data
      if (batch.length < perPage) break;
    }

    // Siapkan field CSV dalam urutan tertentu
    const fields = [
      'nim',
      'nama',
      'judul_indonesia',
      'judul_inggris',
      'status',
      'judul_tugas_akhir_program_studi',
      'jenis_jalur',
    ];

    const parser = new Parser({ fields, withBOM: true });
    const csv = parser.parse(collected);

    // Simpan file
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .replace('Z', '');
    const filename = `ta_auto_${collected.length}_${stamp}.csv`;
    const filepath = path.join(EXPORT_DIR, filename);
    fs.writeFileSync(filepath, csv, 'utf8');

    const downloadUrl = `/exports/${filename}`;

    return res.json({
      saved: true,
      requested_target: target,
      per_page: perPage,
      count: collected.length,
      file: filename,
      download_url: downloadUrl,
      attempts,
      tip: 'Buka download_url untuk mengunduh CSV.',
    });
  } catch (err) {
    console.error('Save CSV Auto error:', err?.response?.status, err?.response?.data || err.message);
    return res.status(err?.response?.status || 500).json({
      error: true,
      message:
        err?.response?.data?.message ||
        err?.message ||
        'Terjadi kesalahan saat menyimpan CSV (paginate otomatis).',
    });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
