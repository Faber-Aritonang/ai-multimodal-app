/**
 * Konfigurasi PostCSS.
 *
 * WAJIB ada: tanpa file ini Vite tidak menyalurkan app.css ke Tailwind, sehingga
 * direktif @tailwind di app.css dibiarkan mentah dan seluruh class utilitas
 * (bg-gradient-to-br, rounded-2xl, w-5, dst.) tidak pernah dibuat -> UI tampil
 * tanpa style meski build tetap "sukses".
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
