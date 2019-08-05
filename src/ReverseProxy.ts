import * as Debug from "debug";
import * as http from "http";
import { IncomingMessage } from "http";
import * as HttpProxy from "http-proxy";
import * as https from "https";
import { GlobalSharedBasicAuth } from "./auth";
import { HandleUnauthorizedRequestFN } from "./auth/BasicAuth";
import { HttpsMethod, ProxiedContainer } from "./ProxiedContainer";
import { page404 } from "./resources";
import { SSLManager } from "./SSLManager";
import { httpRedirect, httpRespond, isDomainLocal } from "./utils";
import * as _ from "lodash";
import * as morgan from "morgan";

const log = Debug("ReverseProxy");
const requestLogger = Debug("Request");

const morganLogger = morgan("combined", {
  stream: { write: msg => requestLogger(msg) }
});

const httpLogger = (req: IncomingMessage, res: http.ServerResponse) => {
  morganLogger(req as any, res as any, () => {});
};

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
          target: proxiedContainer.getTargetURL(),
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
    httpLogger(req, res);

    const host = req.headers.host || "";

    // Handle LetsEncrypt domain verify checks...
    const acmeResponse = this.sslManager.getAcmeResponse(req);
    if (acmeResponse) {
      return httpRespond(res, 200, acmeResponse);
    }

    // Redirect www.zzz.com -> zzz.com
    if (/^www\./.test(host)) {
      const finalHost = host.substring(4, host.length);
      const finalLocation = `${protocol}://${finalHost}${req.url}`;

      return httpRedirect(res, finalLocation);
    }

    const proxiedContainer = this.getProxiedContainerByDomain(host);

    const handleUnauthorizedRequestFN = this.getHandleUnauthorizedRequestFN(
      req,
      proxiedContainer
    );

    // Handle shared global and container level basic authorization...
    if (handleUnauthorizedRequestFN) {
      const canContinue = handleUnauthorizedRequestFN(req, res);

      if (!canContinue) {
        return;
      }
    }

    if (!proxiedContainer) {
      return httpRespond(res, 404, page404);
    }

    const { httpsMethod } = proxiedContainer.options;

    if (protocol === "http") {
      if (httpsMethod === HttpsMethod.NoHttp) {
        return httpRespond(res, 404, page404);
      }

      if (httpsMethod === HttpsMethod.Recirect) {
        return httpRedirect(res, `https://${host}:${req.url}`);
      }
    } else if (protocol === "https") {
      if (httpsMethod === HttpsMethod.NoHttps) {
        return httpRespond(res, 404, page404);
      }
    }

    return this.proxy.web(req, res, {
      target: proxiedContainer.getTargetURL()
    });
  }

  public async register(proxiedContainer: ProxiedContainer): Promise<void> {
    log(`Registered: ${proxiedContainer}!`);
    this.proxiedContainers.push(proxiedContainer);
  }

  public async unregister(removedContainerID: string): Promise<void> {
    log(`Unregistering containers with id: ${removedContainerID}...`);
    this.proxiedContainers = this.proxiedContainers.filter(proxiedContainer => {
      const shouldUnregister = proxiedContainer.id === removedContainerID;

      log(`Unregistered: ${proxiedContainer}!`);

      return !shouldUnregister;
    });
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

    // Pick random container for correct domain with highest priority possible
    return _.sample(thisDomainProxiedContainersWithBestPriority) || null;
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
