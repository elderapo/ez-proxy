import * as dns from "dns";
import * as express from "express";
import * as parseDomainPackage from "parse-domain";
import * as publicIP from "public-ip";
import { promisify } from "util";

export const sleep = promisify(setTimeout);

export const dnsLookup = promisify(dns.lookup);
export const dnsReverse = promisify(dns.reverse);

export const getPublicIP = async (): Promise<string> => await publicIP.v4();

export const parseDomain = (req: express.Request) => {
  const host = req.get("host");

  const parsed = parseDomainPackage(host);

  return {
    subdomain: parsed.subdomain as string,
    domain: parsed.domain as string,
    tld: parsed.tld as string
  };
};
