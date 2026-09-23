import { describe, expect, it } from "bun:test";
import { isSafeExternalUrl } from "../src/net.ts";

describe("isSafeExternalUrl", () => {
  it("accepts public HTTPS sources", () => {
    expect(isSafeExternalUrl("https://example.com/feed.xml")).toBe(true);
    expect(isSafeExternalUrl("https://8.8.8.8/feed")).toBe(true);
    expect(isSafeExternalUrl("https://172.32.0.1/feed")).toBe(true);
  });

  it("rejects local, private, and non-HTTPS targets", () => {
    expect(isSafeExternalUrl("http://example.com/feed.xml")).toBe(false);
    expect(isSafeExternalUrl("https://localhost/feed")).toBe(false);
    expect(isSafeExternalUrl("https://127.0.0.1/feed")).toBe(false);
    expect(isSafeExternalUrl("https://10.0.0.5/feed")).toBe(false);
    expect(isSafeExternalUrl("https://service.internal/feed")).toBe(false);
  });

  // 0.0.0.0 routes to the local host on Linux and was the one dotted-quad
  // loopback the private-range list did not cover.
  it("rejects the unspecified address and its aliases", () => {
    expect(isSafeExternalUrl("https://0.0.0.0/feed")).toBe(false);
    expect(isSafeExternalUrl("https://0.0.0.0:8080/feed")).toBe(false);
    expect(isSafeExternalUrl("https://api.localhost/feed")).toBe(false);
  });

  it("rejects cloud metadata and carrier-grade NAT ranges", () => {
    expect(isSafeExternalUrl("https://169.254.169.254/latest/meta-data")).toBe(
      false,
    );
    expect(isSafeExternalUrl("https://100.64.0.1/feed")).toBe(false);
    expect(isSafeExternalUrl("https://100.128.0.1/feed")).toBe(true);
  });

  // new URL() folds these into a dotted quad before the range check runs.
  it("rejects short-form, hex and decimal loopback literals", () => {
    for (const target of [
      "https://127.1/feed",
      "https://0x7f.0.0.1/feed",
      "https://2130706433/feed",
      "https://0177.0.0.1/feed",
    ]) {
      expect(isSafeExternalUrl(target)).toBe(false);
    }
  });

  it("rejects IPv6 loopback, ULA and the full link-local range", () => {
    expect(isSafeExternalUrl("https://[::1]/feed")).toBe(false);
    expect(isSafeExternalUrl("https://[fd00::1]/feed")).toBe(false);
    expect(isSafeExternalUrl("https://[fe80::1]/feed")).toBe(false);
    expect(isSafeExternalUrl("https://[feba::1]/feed")).toBe(false);
    expect(isSafeExternalUrl("https://[::ffff:127.0.0.1]/feed")).toBe(false);
    expect(isSafeExternalUrl("https://[2606:4700::1111]/feed")).toBe(true);
  });

  // A fully-qualified name keeps its trailing dot through URL parsing and
  // resolves the same as the bare name, so every suffix check has to see the
  // normalized host. The crawler runs where *.svc.cluster.local resolves.
  it("rejects internal suffixes carrying a trailing dot", () => {
    for (const target of [
      "https://localhost./feed",
      "https://feeds.default.svc.cluster.local./feed",
      "https://service.internal./feed",
      "https://api.localhost./feed",
      "https://printer.home.arpa./feed",
      "https://service.internal../feed",
    ]) {
      expect(isSafeExternalUrl(target)).toBe(false);
    }
    expect(isSafeExternalUrl("https://example.com./feed")).toBe(true);
  });

  it("rejects malformed input instead of throwing", () => {
    expect(isSafeExternalUrl("not-a-url")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("https://bare-host/feed")).toBe(false);
  });
});
