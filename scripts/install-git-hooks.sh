#!/bin/sh
# Memasang hook git dari scripts/git-hooks/ ke .git/hooks/.
#
# Sengaja TIDAK mengubah konfigurasi git (mis. core.hooksPath) dan tidak
# menyalin berkas ke lokasi yang ter-commit: hook adalah pengaturan lokal tiap
# developer, jadi cara ini tidak mencampuri konfigurasi siapa pun dan tetap
# aman kalau dijalankan berkali-kali.
#
# Pemakaian: bash scripts/install-git-hooks.sh

set -eu

akar=$(git rev-parse --show-toplevel)
sumber="$akar/scripts/git-hooks"
tujuan="$akar/.git/hooks"

if [ ! -d "$sumber" ]; then
  echo "Tidak menemukan $sumber" >&2
  exit 1
fi

for hook in "$sumber"/*; do
  [ -f "$hook" ] || continue
  nama=$(basename "$hook")
  cp "$hook" "$tujuan/$nama"
  chmod +x "$tujuan/$nama"
  echo "Terpasang: .git/hooks/$nama"
done

echo
echo "Selesai. Coba dengan: git commit --allow-empty -m uji"
echo "Hook akan menolak commit kalau ada berkas mirip kredensial di staging."
