/**
 * `new URL()` already normalizes short-form, hex and octal IPv4 literals to a
 * dotted quad (`127.1` -> `127.0.0.1`), so only the canonical form reaches
 * here. IPv6 literals never normalize to a dotted quad, hence the separate
 * check below instead of relying on the trailing `includes(".")` gate.
 */
function toIpv4Number(hostname: string): number | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  let address = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    address = address * 256 + octet;
  }
  return address >>> 0;
}

function isBlockedIpv4(address: number): boolean {
  const a = address >>> 24;
  const b = (address >>> 16) & 0xff;
  return (
    a === 0 || // 0.0.0.0/8: "this network", routes to the local host on Linux
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 192 && b === 168) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

/**
 * Allowlist instead of a blocklist: only global unicast (2000::/3) is routable
 * on the public internet, so loopback, ULA, link-local and IPv4-mapped forms
 * such as `::ffff:7f00:1` are all rejected without enumerating them. The range
 * still admits 2001:db8::/32 (documentation) and 2002::/16 (6to4); neither
 * points back at this host's network, so they are out of scope here.
 */
function isPublicIpv6(hostname: string): boolean {
  return /^[23][0-9a-f]{0,3}:/.test(hostname);
}

/**
 * Gate for URLs that come from agent state rather than the static source list.
 * Blocks non-HTTPS and any literal address that points back at the crawler's
 * own network. It does NOT resolve DNS, so a hostname that resolves to a
 * private address (rebinding) still reaches the fetch layer; egress filtering
 * is the control for that.
 */
export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    // A fully-qualified name keeps its trailing dot through URL parsing, and
    // `foo.internal.` resolves exactly like `foo.internal` — without stripping
    // it, every suffix check below is one character away from being bypassed.
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.+$/, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home.arpa")
    ) {
      return false;
    }
    if (hostname.includes(":")) return isPublicIpv6(hostname);
    const address = toIpv4Number(hostname);
    if (address !== null) return !isBlockedIpv4(address);
    return hostname.includes(".");
  } catch {
    return false;
  }
}
