/**
 * Geolokasi IP untuk jejak pendaftaran (lihat authController.register).
 *
 * Layanan: ipwho.is — gratis, tanpa API key, HTTPS, mengembalikan kota,
 * negara, dan ISP/ASN. Kegagalan di sini TIDAK PERNAH boleh menahan proses
 * pendaftaran: lookup hanya penanda untuk review admin, jadi semua error,
 * timeout, dan IP privat diterima sebagai `null` (artinya: tanpa lokasi).
 *
 * Lingkungan tes dilarang menyentuh jaringan, jadi lookup langsung `null`
 * saat NODE_ENV=test (lihat tests/registerTrace.test.js untuk uji logikanya
 * dengan fetch yang dimock).
 */

// Timeout singkat: pendaftaran menunggu hasil ini. 1,5 detik lebih dari cukup
// untuk satu request ke layanan ringan; lewat dari itu, lokasi dilewati.
const LOOKUP_TIMEOUT_MS = 1500;

// IP privat/loopback tidak bisa di-lookup (dan memang tidak ada gunanya):
// alamat lokal tidak punya lokasi publik.
const isPrivateIp = (ip) => {
  if (!ip) return true;
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
};

/**
 * @param {string} ip alamat IP publik klien (req.ip — trust proxy sudah diset)
 * @returns {Promise<null|{city: string, country: string, isp: string}>}
 */
const lookupIp = async (ip) => {
  if (process.env.NODE_ENV === 'test') return null;
  if (isPrivateIp(ip)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ai-multimodal-app/registration' }
    });

    if (!response.ok) return null;

    const data = await response.json();

    // ipwho.is menandai lookup yang gagal dengan success:false
    if (data?.success === false) return null;

    return {
      city: typeof data?.city === 'string' ? data.city : '',
      country: typeof data?.country === 'string' ? data.country : '',
      isp: typeof data?.connection?.isp === 'string' ? data.connection.isp : ''
    };
  } catch (error) {
    // Abaikan: tanpa lokasi tetap layanan, pendaftaran tidak boleh gagal.
    console.warn('[ipGeo] lookup gagal untuk', ip, '-', error?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { lookupIp, isPrivateIp };
