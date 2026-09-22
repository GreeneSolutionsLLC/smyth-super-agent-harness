// Preload fix for Node 22 Happy Eyeballs hang (dead IPv6 route on this machine).
// Node's autoSelectFamily (default true) tries IPv6 first and hangs forever
// instead of falling back to IPv4. curl works; node fetch/https/npm all hang.
// Load with: NODE_OPTIONS="--require=scripts/ipv4-preload.cjs"
try {
  const net = require("net");
  if (typeof net.setDefaultAutoSelectFamily === "function") {
    net.setDefaultAutoSelectFamily(false);
    console.log("[ipv4-preload] autoSelectFamily disabled — IPv4 forced for Node sockets");
  }
} catch (e) {
  console.warn("[ipv4-preload] failed:", e.message);
}
