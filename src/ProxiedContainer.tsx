import { DeepReadonly } from "@elderapo/utils";
import { BasicAuth, IBasicAuthOptions } from "./auth/BasicAuth";

export enum HttpsMethod {
  NoRecirect = "noredirect",
  Recirect = "redirect",
  NoHttp = "nohttp",
  NoHttps = "nohttps",

  Default = "redirect"
}

export interface IProxiedContainerOptions {
  domain: string;
  containerPort: number;
  letsEncryptEmail: string | null;
  httpsMethod: HttpsMethod;

  ezProxyPriority: number;

  basicAuthOptions: IBasicAuthOptions | null;
}

export interface IPRoxiedContainerState {
  ip: string;
}

export interface IProxiedContainer {
  options: IProxiedContainerOptions;
  state: IPRoxiedContainerState;
}

export class ProxiedContainer implements DeepReadonly<IProxiedContainer> {
  public readonly options: DeepReadonly<IProxiedContainerOptions>;
  public readonly state: DeepReadonly<IPRoxiedContainerState>;

  public readonly basicAuth: BasicAuth | null = null;

  constructor(public readonly id: string, args: IProxiedContainer) {
    this.options = args.options;
    this.state = args.state;

    this.basicAuth = args.options.basicAuthOptions
      ? new BasicAuth(args.options.basicAuthOptions)
      : null;
  }

  public getTargetURL() {
    return `http://${this.state.ip}:${this.options.containerPort}`;
  }
}

ProxiedContainer.prototype.toString = function() {
  return `ProxiedContainer(id: ${
    this.id
  }, target: ${this.getTargetURL()}, domain: ${
    this.options.domain
  }, httpsMethod: ${this.options.httpsMethod}, priority: ${
    this.options.ezProxyPriority
  })`;
};
