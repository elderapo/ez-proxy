import { DeepReadonly } from "@elderapo/utils";
import { IBasicAuthOptions } from "./auth/BasicAuth";

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

  constructor(public readonly id: string, args: IProxiedContainer) {
    this.options = args.options;
    this.state = args.state;
  }

  public getInternalURL() {
    const url = `http://${this.state.ip}:${this.options.containerPort}`;

    return url;
  }
}
