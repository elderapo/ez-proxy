import * as Debug from "debug";
import { IncomingMessage } from "http";
import * as path from "path";
import * as Redbird from "redbird";
import { Stream } from "stream";
import { ProxyAuth } from "./ProxyAuth";
import { page404 } from "./resources/page404";
import { dnsLookup, getPublicIP, isDomainLocal } from "./utils";

const log = Debug("ReverseProxy");

class RedbirdStream extends Stream.Writable {
  private log = Debug("Redbird");
  _write(chunk, enc, next) {
    this.log(chunk.toString().replace(/\n$/, ""));

    return next();
  }
}

export class ReverseProxy {
  private proxy;

  constructor(private auth: ProxyAuth) {
    this.proxy = new Redbird({
      bunyan: {
        name: "redbird",
        stream: new RedbirdStream()
      },
      port: 80,
      letsencrypt: {
        path: path.join(__dirname, "..", ".certificates")
      },
      ssl: {
        // http2: true,
        port: 443
      },
      resolvers: [
        (host, url, req: IncomingMessage) => {
          if (isDomainLocal(host)) {
            return null;
          }

          if (!this.auth.isEnabled()) {
            return null;
          }

          if (this.auth.isAuthorized(req)) {
            return null;
          }

          log(`Starting authentication...`);
          return this.auth.getAuthUrl();
        }
      ]
    });

    this.proxy.notFound((req, res) => {
      const host = req.headers.host;
      if (/^www\./.test(host)) {
        const finalHost = host.substring(4, host.length);
        const finalLocation = "http://" + finalHost + req.url;

        res.writeHead(301, {
          Location: finalLocation,
          Expires: new Date().toUTCString()
        });
        return res.end();
      }

      res.statusCode = 404;
      res.write(page404);
      res.end();
    });
  }

  public async register(
    domain: string,
    targetIP: string,
    targetPort: number,
    letsEncryptEmail: string | null
  ): Promise<void> {
    const target = `http://${targetIP}:${targetPort}`;
    const isLocal = await this.isLocal(domain);

    log(
      `Registering domain(${domain}) target(${target}) isLocal(${isLocal}) letsEncryptEmail(${letsEncryptEmail})...`
    );

    const options =
      letsEncryptEmail && !isLocal
        ? {
            ssl: {
              letsencrypt: {
                email: letsEncryptEmail, // Domain owner/admin email
                production: !isLocal
              }
            }
          }
        : {};

    this.proxy.register(domain, target, options);
    // this.proxy.register(domain + ".loc", target);
  }

  public async unregister(
    domain: string,
    targetIP: string,
    targetPort: number
  ): Promise<void> {
    const target = `http://${targetIP}:${targetPort}`;
    log(`Unregistering domain(${domain}) target(${target})...`);

    this.proxy.unregister(domain, target);
    // this.proxy.unregister(domain + ".loc", target);
  }

  private async isLocal(domain: string): Promise<boolean> {
    const publicIP = await getPublicIP();

    const { address } = await dnsLookup(domain);

    if (address === publicIP) {
      return false;
    }

    return isDomainLocal(domain);
  }
}
