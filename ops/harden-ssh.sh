#!/bin/sh
# Run once on the server, as root, AFTER confirming you can sign in with an SSH key:
# turns off password sign-in over SSH, so the root password can't be guessed from the internet.
# The hosting company's own console still works with the password if you are ever locked out.
set -eu
[ -s /root/.ssh/authorized_keys ] || { echo "No SSH key is installed for root; not changing anything."; exit 1; }
cat > /etc/ssh/sshd_config.d/60-keys-only.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
sshd -t
systemctl reload ssh 2>/dev/null || systemctl reload sshd
echo "Password sign-in over SSH is off. Keep this session open and try a new key sign-in before closing it."
