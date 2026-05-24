import { Resolver, type LookupAddress, type LookupAllOptions, type LookupOneOptions } from "node:dns";
import { createRequire } from "node:module";
import { isIP } from "node:net";

type LookupOptions = LookupOneOptions | LookupAllOptions | number;
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;
type LookupFunction = (
  hostname: string,
  options: LookupOptions | LookupCallback,
  callback?: LookupCallback
) => void;

const DEV_DNS_SERVERS = ["8.8.8.8", "1.1.1.1"];
const require = createRequire(import.meta.url);

let installed = false;

function getConfiguredServers(): string[] {
  const rawServers = process.env["DNS_RESOLVER_SERVERS"];
  if (rawServers) {
    return rawServers
      .split(",")
      .map((server) => server.trim())
      .filter(Boolean);
  }

  return process.env["NODE_ENV"] === "development" ? DEV_DNS_SERVERS : [];
}

export function installDnsFallback(): string[] {
  if (installed) return [];

  const servers = getConfiguredServers();
  if (servers.length === 0) return [];

  const resolver = new Resolver();
  resolver.setServers(servers);

  const mutableDns = require("node:dns") as { lookup: LookupFunction };
  const nativeLookup = mutableDns.lookup.bind(mutableDns);

  const lookupWithFallback: LookupFunction = (hostname, options, callback) => {
    const lookupOptions = typeof options === "function" ? {} : options;
    const done = typeof options === "function" ? options : callback;

    if (!done) {
      nativeLookup(hostname, lookupOptions as LookupOptions, callback);
      return;
    }

    const ipFamily = isIP(hostname);
    if (ipFamily !== 0) {
      done(null, hostname, ipFamily);
      return;
    }

    const family =
      typeof lookupOptions === "number"
        ? lookupOptions
        : lookupOptions.family;
    const all = typeof lookupOptions === "object" && lookupOptions.all === true;

    const handleResolved = (
      err: NodeJS.ErrnoException | null,
      addresses?: string[],
      resolvedFamily?: 4 | 6
    ) => {
      if (err || !addresses || addresses.length === 0 || !resolvedFamily) {
        nativeLookup(hostname, lookupOptions as LookupOptions, done);
        return;
      }

      if (all) {
        done(
          null,
          addresses.map((address) => ({ address, family: resolvedFamily }))
        );
        return;
      }

      done(null, addresses[0] as string, resolvedFamily);
    };

    if (family === 6) {
      resolver.resolve6(hostname, (err, addresses) => handleResolved(err, addresses, 6));
      return;
    }

    resolver.resolve4(hostname, (err, addresses) => handleResolved(err, addresses, 4));
  };

  mutableDns.lookup = lookupWithFallback;
  installed = true;

  return servers;
}
