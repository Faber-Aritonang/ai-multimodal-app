/**
 * Seed Script: Create Admin
 * Upsert admin record ke koleksi Admin berdasarkan uid Firebase.
 *
 * Pemakaian:
 *   node scripts/createAdmin.js --uid <firebase-uid> --email <email> --name "Admin Name"
 *
 * Atau via env:
 *   ADMIN_UID=xxx ADMIN_EMAIL=xxx ADMIN_NAME="Admin" node scripts/createAdmin.js
 *
 * Dapatkan <firebase-uid> dari Firebase Console -> Authentication -> Users,
 * atau dari decoded token user yang sudah login dengan Google.
 *
 * Setelah admin dibuat, login ulang di aplikasi:
 *   JWT akan berisi role 'admin' dan frontend akan mengarahkan ke /admin.
 */

require('dotenv').config();

// argv: node scripts/createAdmin.js --uid xxx --email xxx --name "Admin Name"
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      args[key] = value;
      if (value !== true) i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const uid = args.uid || process.env.ADMIN_UID;
  const email = args.email || process.env.ADMIN_EMAIL;
  const displayName = args.name || process.env.ADMIN_NAME || 'Admin';

  if (!uid || !email) {
    console.error('Error: --uid and --email are required.');
    console.error('');
    console.error('Usage:');
    console.error('  node scripts/createAdmin.js --uid <firebase-uid> --email <email> --name "Admin Name"');
    console.error('');
    console.error('Or via environment variables:');
    console.error('  ADMIN_UID=xxx ADMIN_EMAIL=xxx node scripts/createAdmin.js');
    process.exit(1);
  }

  const mongoose = require('mongoose');
  const Admin = require('../models/Admin');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB connected');

    const admin = await Admin.findOneAndUpdate(
      { uid },
      { uid, email: email.toLowerCase(), displayName, role: 'admin' },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    console.log('Admin upserted successfully:');
    console.log({
      uid: admin.uid,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
    });
    console.log('');
    console.log('Next step: login ulang dengan akun Google tersebut di aplikasi.');
  } catch (error) {
    console.error('Failed to create admin:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
