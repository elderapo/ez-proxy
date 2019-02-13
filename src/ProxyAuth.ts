import * as basicAuth from "basic-auth";
import * as cookieParser from "cookie-parser";
import * as Cookies from "cookies";
import * as crypto from "crypto";
import * as Debug from "debug";
import * as express from "express";
import { IncomingMessage } from "http";
import { parseDomain } from "./utils";

const logger = Debug("ProxyAuth");

export class ProxyAuth {
  public static readonly AUTH_TOKEN_COOKIE_NAME = "__EZ_PROXY_AUTH_TOKEN__";
  private port: number = 8888;

  private app: express.Application;
  private authToken: string;

  constructor(private username: string, private password: string) {
    if (!this.isEnabled()) {
      logger(`Proxy auth is disabled!`);
      return;
    }
    logger(
      `Enabling basic auth: username(${username}), password(${password})...`
    );

    this.start();

    this.authToken = crypto
      .createHash("sha256")
      .update(`${username}:${password}`)
      .digest("hex");
  }

  private async start() {
    this.app = express();

    this.app.use(cookieParser());

    this.app.use((req, res, next) => {
      const user = basicAuth(req);

      if (!user || user.name !== this.username || user.pass !== this.password) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="MyRealmName"');

        return res.end("Unauthorized");
      }
      logger(`Successfull authentication!`);

      const parsedDomain = parseDomain(req);
      const domain = `.${parsedDomain.domain}.${parsedDomain.tld}`;

      res.cookie(ProxyAuth.AUTH_TOKEN_COOKIE_NAME, this.authToken, {
        domain,
        expires: false,
        httpOnly: false
      });

      return res.redirect(req.originalUrl);
    });

    this.app.listen(this.port);
  }

  public isAuthorized(req: IncomingMessage): boolean {
    const cookies = new Cookies(req, null);
    const authToken = cookies.get(ProxyAuth.AUTH_TOKEN_COOKIE_NAME);

    console.log(authToken, this.authToken);

    return authToken === this.authToken;
  }

  public isEnabled(): boolean {
    return !!this.username && !!this.password;
  }

  public getAuthUrl() {
    return `http://localhost:${this.port}`;
  }
}
