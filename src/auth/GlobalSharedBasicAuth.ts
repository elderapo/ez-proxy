import * as Cookies from "cookies";
import { IncomingMessage, ServerResponse } from "http";
import { parseDomain } from "../utils";
import { BasicAuth } from "./BasicAuth";

export class GlobalSharedBasicAuth extends BasicAuth {
  protected handleUnauthorizedRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): boolean {
    const canContinue = super.handleUnauthorizedRequest(req, res);

    if (canContinue) {
      try {
        const parsedDomain = parseDomain(req);

        const cookies = new Cookies(req, res);

        cookies.set(this.options.cookieName, this.authToken, {
          domain: `.${parsedDomain.domain}.${parsedDomain.tld}`,
          httpOnly: false
        });
      } catch (ex) {
        // cuz parseDomain throws an error for IPs
      }
    }

    return canContinue;
  }
}
