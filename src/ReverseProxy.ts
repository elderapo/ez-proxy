import * as Redbird from "redbird";
import * as Debug from "debug";
import * as path from "path";
import { page404 } from "./resources/page404";
import { Stream } from "stream";

const log = Debug("ReverseProxy");

class RedbirdStream extends Stream.Writable {
  private log = Debug("Redbird");
  _write(chunk, enc, next) {
    this.log(chunk.toString());

    return next();
  }
}

export class ReverseProxy {
  private proxy;

  constructor() {
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
        http2: true,
        port: 443
      }
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
    targetDomain: string,
    targetPort: number,
    letsEncryptEmail: string | null
  ): Promise<void> {
    const target = `http://${targetDomain}:${targetPort}`;
    log(`Registering domain(${domain}) target(${target})...`);

    const options = letsEncryptEmail
      ? {
          ssl: {
            letsencrypt: {
              email: letsEncryptEmail, // Domain owner/admin email
              production: !(await this.isLocal(targetDomain))
            }
          }
        }
      : {};

    this.proxy.register(domain, target, options);
    // this.proxy.register(domain + ".loc", target);
  }

  public async unregister(
    domain: string,
    targetDomain: string,
    targetPort: number
  ): Promise<void> {
    const target = `http://${targetDomain}:${targetPort}`;
    log(`Unregistering domain(${domain}) target(${target})...`);

    this.proxy.unregister(domain, target);
    // this.proxy.unregister(domain + ".loc", target);
  }

  private async isLocal(domain: string): Promise<boolean> {
    if (domain.match(/.loc$/g)) {
      return true;
    }

    if (domain.match(/.local$/g)) {
      return true;
    }

    return false;
  }
}
