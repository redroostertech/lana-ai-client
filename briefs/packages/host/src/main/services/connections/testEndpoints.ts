import type { HTTPTransport } from "@lana/core/executors";

/** The provider hosts a test origin stands in for. */
const PROVIDER_HOSTS = new Set(["app.clio.com", "ca.app.clio.com", "eu.app.clio.com", "au.app.clio.com", "graph.microsoft.com", "login.microsoftonline.com"]);

/**
 * Tests only: `LANA_TEST_CONNECTOR_ORIGIN=http://127.0.0.1:<port>` sends Clio, Graph and
 * Microsoft sign-in requests to a fake server on this computer instead. Honored only in
 * unpackaged builds and only for a loopback origin; a packaged app ignores it.
 */
export function testConnectorOrigin(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): string | null {
  const raw = env["LANA_TEST_CONNECTOR_ORIGIN"]?.trim() ?? "";
  if (isPackaged || raw === "") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !(url.hostname === "127.0.0.1" || url.hostname === "localhost")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Tests only: `LANA_TEST_DIRECTORY_URL=http://127.0.0.1:<port>/lana-ai/v1/discovery` asks a
 * fake LANA directory for discovery (and so for the organization's apps). Honored only in
 * unpackaged builds and only on loopback; a packaged app always uses LANA's directory.
 */
export function testDirectoryURL(env: Readonly<Record<string, string | undefined>>, isPackaged: boolean): string | null {
  const raw = env["LANA_TEST_DIRECTORY_URL"]?.trim() ?? "";
  if (isPackaged || raw === "") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !(url.hostname === "127.0.0.1" || url.hostname === "localhost")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Rewrites `https://<provider host>/<path>` to `<origin>/<provider host>/<path>` before
 * sending, so the executors keep building (and hashing) the real URLs while a fake server
 * answers. Any other URL passes through unchanged.
 */
export function redirectedTransport(transport: HTTPTransport, origin: string): HTTPTransport {
  return {
    send(request) {
      const match = /^https:\/\/([^/?#]+)(.*)$/.exec(request.url);
      const host = match?.[1]?.toLowerCase();
      if (match === null || host === undefined || !PROVIDER_HOSTS.has(host)) return transport.send(request);
      return transport.send({ ...request, url: `${origin}/${host}${match[2] ?? ""}` });
    },
  };
}
