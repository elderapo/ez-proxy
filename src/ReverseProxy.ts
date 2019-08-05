import * as Debug from "debug";
import * as http from "http";
import { IncomingMessage } from "http";
import * as HttpProxy from "http-proxy";
import * as https from "https";
import { ProxyAuth } from "./ProxyAuth";
import { page404 } from "./resources/page404";
import { isDomainLocal } from "./utils";
import { SSLManager } from "./SSLManager";
import * as tls from "tls";

const log = Debug("ReverseProxy");

export interface IReverseProxyConnectionOptions {
  virtualHost: string;

  containerPort: number;
  containerIP: string;

  letsEncryptEmail?: string;
  ezProxyPriority?: number;
}

export interface IProxyItem extends IReverseProxyConnectionOptions {
  containerID: string;
}

export class ReverseProxy {
  private proxy: HttpProxy;
  private httpServer: http.Server;
  private httpsServer: https.Server;

  private sslManager = new SSLManager();

  private items: IProxyItem[] = [];

  constructor(private auth: ProxyAuth) {
    this.proxy = HttpProxy.createProxyServer();

    this.httpServer = http.createServer((req, res) =>
      this.httpRequestHandler(req, res, "http")
    );
    this.httpServer.listen(80);

    this.httpsServer = https.createServer(
      {
        SNICallback: async (domain, done) => {
          const item = this.getProxyItemByDomain(domain);

          if (!item) {
            return done(new Error("Unknown domain..."), null);
          }

          const secureContext = await this.sslManager.getSSLSecureContext(
            domain,
            item.letsEncryptEmail
          );

          return done(null, secureContext);
        }
      },
      (req, res) => this.httpRequestHandler(req, res, "https")
    );
    this.httpsServer.listen(443);
  }

  private async httpRequestHandler(
    req: IncomingMessage,
    res: http.ServerResponse,
    protocol: "http" | "https"
  ): Promise<void> {
    const host = req.headers.host;

    const acmeResponse = this.sslManager.getAcmeResponse(req);

    if (acmeResponse) {
      res.write(acmeResponse);
      res.end();
      return;
    }

    if (
      !isDomainLocal(host) &&
      this.auth.isEnabled() &&
      !this.auth.isAuthorized(req)
    ) {
      return this.proxy.web(req, res, {
        target: this.auth.getAuthUrl()
      });
    }

    if (/^www\./.test(host)) {
      const finalHost = host.substring(4, host.length);
      const finalLocation = `${protocol}://${finalHost}${req.url}`;

      res.writeHead(301, {
        Location: finalLocation,
        Expires: new Date().toUTCString()
      });

      return res.end();
    }

    const item = this.getProxyItemByDomain(host);

    if (item) {
      return this.proxy.web(req, res, {
        target: `http://${item.containerIP}:${item.containerPort}`,
        ws: true
      });
    }

    res.statusCode = 404;
    res.write(page404);
    res.end();
  }

  public async register(
    containerID: string,
    options: IReverseProxyConnectionOptions
  ): Promise<void> {
    const item: IProxyItem = {
      containerID,
      ...options
    };

    this.items.push(item);
  }

  public async unregister(containerID: string): Promise<void> {
    this.items = this.items.filter(item => item.containerID !== containerID);
  }

  private getProxyItemByDomain(domain: string): IProxyItem | null {
    for (let item of this.items) {
      if (item.virtualHost === domain) {
        return item;
      }
    }

    return null;
  }
}
