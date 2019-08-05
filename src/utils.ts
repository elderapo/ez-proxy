import * as child_process from "child_process";
import * as dns from "dns";
import * as express from "express";
import * as http from "http";
// @ts-ignore
import * as parseDomainPackage from "parse-domain";
import * as path from "path";
// @ts-ignore
import * as publicIP from "public-ip";
// @ts-ignore
import * as sslUtils from "ssl-utils";
import { promisify } from "util";
import { KeyValueStore } from "./types";

export const sleep = promisify(setTimeout);

export const dnsLookup = promisify(dns.lookup);
export const dnsReverse = promisify(dns.reverse);
export const exec = promisify(child_process.exec);

export const getPublicIP = async (): Promise<string> => await publicIP.v4();

export const parseDomain = (req: http.IncomingMessage) => {
  let host = req.headers.host || "";

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
    sslUtils.checkCertificateExpiration(cert, (err: Error, expiry: Date) => {
      if (err) {
        return reject(err);
      }

      return resolve(expiry);
    });
  });
};

export const httpSetHeaders = (
  res: http.ServerResponse,
  headers?: KeyValueStore
): void => {
  for (let headerKey in headers) {
    const headerValue = headers[headerKey];

    res.setHeader(headerKey, headerValue);
  }
};

export const httpRedirect = (
  res: http.ServerResponse,
  location: string
): void => {
  res.writeHead(301, {
    Location: location
  });

  res.end();
};

export const httpRespond = (
  res: http.ServerResponse,
  code: number,
  body: string | Buffer
): void => {
  res.statusCode = code;
  res.write(body);

  res.end();
};
