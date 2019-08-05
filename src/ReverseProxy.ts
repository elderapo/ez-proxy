import * as Debug from "debug";
import * as http from "http";
import { IncomingMessage } from "http";
import * as HttpProxy from "http-proxy";
import * as https from "https";
import { GlobalSharedBasicAuth } from "./auth";
import { HandleUnauthorizedRequestFN } from "./auth/BasicAuth";
import { HttpsMethod, ProxiedContainer } from "./ProxiedContainer";
import { page404 } from "./resources/page404";
import { SSLManager } from "./SSLManager";
import { httpRedirect, httpRespond, isDomainLocal } from "./utils";

const log = Debug("ReverseProxy");

export interface IReverseProxyOptions {
  globalBasicAuth?: GlobalSharedBasicAuth | null;
}

export class ReverseProxy {
  private proxy: HttpProxy;
  private httpServer: http.Server;
  private httpsServer: https.Server;

  private sslManager = new SSLManager();

  private proxiedContainers: ProxiedContainer[] = [];

  constructor(private options: IReverseProxyOptions = {}) {
    this.proxy = HttpProxy.createProxyServer({
      secure: true,
      ws: true
    });

    this.httpServer = http.createServer((req, res) =>
      this.httpRequestHandler(req, res, "http")
    );
    this.httpServer.listen(80);

    this.httpsServer = https.createServer(
      {
        SNICallback: async (domain, done) => {
          const proxiedContainer = this.getProxiedContainerByDomain(domain);

          if (!proxiedContainer) {
            return done(new Error("Unknown domain..."), null as any);
          }

          const secureContext = await this.sslManager.getSSLSecureContext(
            proxiedContainer.options.domain,
            proxiedContainer.options.letsEncryptEmail
          );

          return done(null, secureContext);
        }
      },
      (req, res) => this.httpRequestHandler(req, res, "https")
    );

    this.httpsServer.on("upgrade", (req, socket, head) => {
      const host = req.headers.host;
      const proxiedContainer = this.getProxiedContainerByDomain(host);

      const handleUnauthorizedRequestFN = this.getHandleUnauthorizedRequestFN(
        req,
        proxiedContainer
      );

      if (handleUnauthorizedRequestFN) {
        return;
      }

      if (proxiedContainer) {
        this.proxy.ws(req, socket, head, {
          target: proxiedContainer.getInternalURL(),
          ws: true
        });
      }
    });

    this.httpsServer.listen(443);
  }

  private async httpRequestHandler(
    req: IncomingMessage,
    res: http.ServerResponse,
    protocol: "http" | "https"
  ): Promise<void> {
    const host = req.headers.host || "";
    const proxiedContainer = this.getProxiedContainerByDomain(host);

    const handleUnauthorizedRequestFN = this.getHandleUnauthorizedRequestFN(
      req,
      proxiedContainer
    );

    if (handleUnauthorizedRequestFN) {
      const canContinue = handleUnauthorizedRequestFN(req, res);

      if (!canContinue) {
        return;
      }
    }

    if (protocol === "http") {
      const acmeResponse = this.sslManager.getAcmeResponse(req);

      if (acmeResponse) {
        res.write(acmeResponse);
        res.end();
        return;
      }

      if (proxiedContainer) {
        if (proxiedContainer.options.httpsMethod === HttpsMethod.NoHttp) {
          return httpRespond(res, 404, page404);
        }

        if (proxiedContainer.options.httpsMethod === HttpsMethod.Recirect) {
          return httpRedirect(res, `https://${host}:${req.url}`);
        }
      }
    }

    if (/^www\./.test(host)) {
      const finalHost = host.substring(4, host.length);
      const finalLocation = `${protocol}://${finalHost}${req.url}`;

      return httpRedirect(res, finalLocation);
    }

    if (!proxiedContainer) {
      return httpRespond(res, 404, page404);
    }

    if (
      proxiedContainer.options.httpsMethod === HttpsMethod.NoHttps &&
      protocol === "https"
    ) {
      return httpRespond(res, 404, page404);
    }

    return this.proxy.web(req, res, {
      target: proxiedContainer.getInternalURL()
    });
  }

  public async register(proxiedContainer: ProxiedContainer): Promise<void> {
    log(`Registering container: ${JSON.stringify(proxiedContainer)}...`);
    this.proxiedContainers.push(proxiedContainer);
  }

  public async unregister(removedContainerID: string): Promise<void> {
    this.proxiedContainers = this.proxiedContainers.filter(
      proxiedContainer => proxiedContainer.id !== removedContainerID
    );
  }

  private getProxiedContainerByDomain(domain: string): ProxiedContainer | null {
    const thisDomainProxiedContainers = this.proxiedContainers.filter(
      proxiedContainer => proxiedContainer.options.domain === domain
    );

    const bestPriority = thisDomainProxiedContainers.reduce(
      (prev, proxiedContainer) => {
        return Math.max(prev, proxiedContainer.options.ezProxyPriority);
      },
      -Infinity
    );

    const thisDomainProxiedContainersWithBestPriority = thisDomainProxiedContainers.filter(
      proxiedContainer =>
        proxiedContainer.options.ezProxyPriority === bestPriority
    );

    return thisDomainProxiedContainersWithBestPriority[0] || null;
  }

  private getHandleUnauthorizedRequestFN(
    req: IncomingMessage,
    proxiedContainer?: ProxiedContainer | null
  ): HandleUnauthorizedRequestFN | null {
    const host = req.headers.host || "";

    if (isDomainLocal(host)) {
      return null;
    }

    if (
      this.options.globalBasicAuth &&
      !this.options.globalBasicAuth.isAuthorized(req)
    ) {
      return this.options.globalBasicAuth.getHandleUnauthorizedRequestFN();
    }

    if (proxiedContainer && proxiedContainer.basicAuth) {
      return proxiedContainer.basicAuth.getHandleUnauthorizedRequestFN();
    }

    return null;
  }
}
