import * as child_process from "child_process";
import * as dns from "dns";
import * as express from "express";
import * as parseDomainPackage from "parse-domain";
import * as path from "path";
import * as publicIP from "public-ip";
import * as sslUtils from "ssl-utils";
import { promisify } from "util";

export const sleep = promisify(setTimeout);

export const dnsLookup = promisify(dns.lookup);
export const dnsReverse = promisify(dns.reverse);
export const exec = promisify(child_process.exec);

export const getPublicIP = async (): Promise<string> => await publicIP.v4();

export const parseDomain = (req: express.Request) => {
  let host = req.get("host");

  const isLocal = isDomainLocal(host);
  let localTld: string = "";

  if (isLocal) {
    localTld = host.includes(".local") ? ".local" : ".loc";
    host = host.replace(localTld, ".com");
  }

  const parsed = parseDomainPackage(host);

  return {
    subdomain: parsed.subdomain as string,
    domain: parsed.domain as string,
    tld: isLocal ? localTld : (parsed.tld as string)
  };
};

export const isDomainLocal = (domain: string): boolean => {
  if (!domain) {
    return false;
  }

  if (domain.match(/.loc$/g)) {
    return true;
  }

  if (domain.match(/.local$/g)) {
    return true;
  }

  return false;
};

export const mkcert = async (args: string): Promise<void> => {
  const mkcertPath = path.join(__dirname, "..", ".bin", "mkcert");

  await exec(`${mkcertPath} ${args}`, {
    env: {
      CAROOT: path.join(__dirname, "..", ".caroot")
    }
  });
};

export const checkCertificateExpiration = async (
  cert: string | Buffer
): Promise<Date> => {
  return new Promise<Date>((resolve, reject) => {
    sslUtils.checkCertificateExpiration(cert, (err, expiry) => {
      if (err) {
        return reject(err);
      }

      return resolve(expiry);
    });
  });
};
