import { networkInterfaces } from "node:os";

// Private ranges first: when a laptop also holds a VPN or virtual-adapter
// address, the one a phone on the venue wifi can reach is almost always the
// RFC1918 one. A public address still qualifies — some venue routers hand those
// out directly — it just ranks last.
function rank(address) {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

/**
 * Every IPv4 address a device on the same network can reach this machine at,
 * best candidate first.
 *
 * The exhibition laptop joins a different network at every venue, so no IP may
 * ever be hardcoded. Both the keepsake QR link and the dev-server origin
 * allowlist are derived from this at runtime instead.
 *
 * @returns {string[]}
 */
export function lanIPv4Addresses() {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      // 169.254.x.x is the link-local address the OS invents when DHCP failed,
      // so it never reaches a phone.
      if (entry.address.startsWith("169.254.")) continue;
      if (!found.includes(entry.address)) found.push(entry.address);
    }
  }
  return found.sort((a, b) => rank(a) - rank(b));
}
