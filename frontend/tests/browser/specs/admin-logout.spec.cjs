/**
 * Spec: logout admin satu klik.
 *
 * Regresi: AdminLayout sebelumnya hanya memanggil navigate('/login') setelah
 * menghapus localStorage. State user di App.jsx masih berisi admin sehingga
 * GuestRoute mengarahkan kembali ke /admin dan user harus mengulang klik.
 */

const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'faber.aritonang@gmail.com';

const READ_AUTH_AND_PAGE = `(() => ({
  path: location.pathname,
  authToken: localStorage.getItem('authToken'),
  user: localStorage.getItem('user')
}))()`;

const CLICK_VISIBLE_LOGOUT = `(() => {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
    candidate.textContent.trim().toLowerCase().includes('logout') && candidate.offsetParent !== null
  );
  if (!button) return false;
  button.click();
  return true;
})()`;

module.exports = {
  name: 'admin-logout',

  async run({ session, reporter, api }) {
    // Dev-login mencari admin berdasarkan email pada collection `admins`.
    // TEST_ADMIN_EMAIL dapat diganti untuk database development yang berbeda.
    const adminLogin = await api.publicPost('/auth/dev-login', {
      email: ADMIN_EMAIL,
      displayName: 'Test Admin'
    });

    reporter.check(
      'dev-login admin berhasil',
      adminLogin.ok && adminLogin.body?.user?.role === 'admin' && Boolean(adminLogin.body?.token),
      adminLogin.body?.message || JSON.stringify(adminLogin.body)
    );

    if (!adminLogin.ok || adminLogin.body?.user?.role !== 'admin') return;

    await session.setAuth({ token: adminLogin.body.token, user: adminLogin.body.user });
    await session.open('/admin');

    const adminPage = await session.waitFor(async () => {
      const state = await session.evaluate(READ_AUTH_AND_PAGE);
      return state.path === '/admin' ? state : null;
    }, { timeoutMs: 15000 });

    reporter.equal('admin dashboard terbuka', adminPage?.path, '/admin');
    reporter.check('sesi admin tersimpan sebelum logout', Boolean(adminPage?.authToken));

    const clicked = await session.evaluate(CLICK_VISIBLE_LOGOUT);
    reporter.equal('tombol logout admin ditemukan dan diklik sekali', clicked, true);

    const loggedOut = await session.waitFor(async () => {
      const state = await session.evaluate(READ_AUTH_AND_PAGE);
      return state.path === '/login' && !state.authToken && !state.user ? state : null;
    }, { timeoutMs: 5000, intervalMs: 100 });

    reporter.equal('satu klik langsung menuju halaman login', loggedOut?.path, '/login');
    reporter.equal('authToken terhapus setelah satu klik', loggedOut?.authToken, null);
    reporter.equal('data user terhapus setelah satu klik', loggedOut?.user, null);

    // Jika logout hanya melakukan navigate tanpa membersihkan state App, route
    // akan kembali ke /admin. Assertion ini mengunci perilaku yang diharapkan.
    await session.open('/admin', { settleMs: 1500 });
    const afterReopen = await session.evaluate(READ_AUTH_AND_PAGE);
    reporter.equal('sesi tidak kembali ke admin setelah logout', afterReopen.path, '/login');
  }
};
