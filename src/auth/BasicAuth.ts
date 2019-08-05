import * as basicAuth from "basic-auth";
import * as Cookies from "cookies";
import * as crypto from "crypto";
import * as Debug from "debug";
import { IncomingMessage, ServerResponse } from "http";
import { httpRespond, httpSetHeaders, parseDomain } from "../utils";
import { IBasicAuthOptions } from "./BasicAuth";

export type HandleUnauthorizedRequestFN = (
  req: IncomingMessage,
  res: ServerResponse
) => boolean;

export interface IBasicAuthOptions {
  username: string;
  password: string;

  cookieName: string;
}

const logger = Debug("BasicAuth");

export class BasicAuth {
  protected readonly authToken: string;

  constructor(protected options: IBasicAuthOptions) {
    this.authToken = crypto
      .createHash("sha256")
      .update(`${options.username}:${options.password}`)
      .digest("hex");
  }

  public isAuthorized(req: IncomingMessage): boolean {
    const cookies = new Cookies(req, null as any);
    const authToken = cookies.get(this.options.cookieName);

    return authToken === this.authToken;
  }

  public getHandleUnauthorizedRequestFN(): HandleUnauthorizedRequestFN {
    return this.handleUnauthorizedRequest.bind(this);
  }

  protected handleUnauthorizedRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): boolean {
    const user = basicAuth(req);

    if (!this.checkBasicAuth(user)) {
      httpSetHeaders(res, {
        "WWW-Authenticate": 'Basic realm="MyRealmName"'
      });
      httpRespond(res, 401, "Unauthorized");

      return false;
    }

    return true;
  }

  private checkBasicAuth(
    providedCredentials?: basicAuth.BasicAuthResult
  ): boolean {
    if (!providedCredentials) {
      return false;
    }

    if (
      providedCredentials.name === this.options.username &&
      providedCredentials.pass === this.options.password
    ) {
      return true;
    }

    return false;
  }
}
