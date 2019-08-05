import * as Debug from "debug";
import * as fs from "fs-extra";
import { Docker } from "node-docker-api";
import { Container } from "node-docker-api/lib/container";
import { Network } from "node-docker-api/lib/network";
import { DockerEvent, DockerEventsListener } from "./DockerEventsListener";
import { ReverseProxy } from "./ReverseProxy";
import { KeyValueStore } from "./types";
import { dnsLookup } from "./utils";
import { ProxiedContainer, HttpsMethod } from "./ProxiedContainer";
import { IBasicAuthOptions } from "./auth/BasicAuth";
import { isValidEnum, sleep } from "@elderapo/utils";

interface IContainerInfo {
  id: string;
  env: KeyValueStore;
  labels: KeyValueStore;
}

const log = Debug("ContainersManager");

export class ContainersManager {
  private dockerEventsListener: DockerEventsListener;

  private internalNetwork: Network;
  private thisContainer: Container;

  constructor(private docker: Docker, private reverseProxy: ReverseProxy) {
    log("Initialzation...");
    this.dockerEventsListener = new DockerEventsListener(docker);

    this.initialize();
  }

  private async initialize(): Promise<void> {
    await this.prepare();
    this.initListeners();
  }

  private async prepare() {
    log(`Fixing network...`);
    this.internalNetwork = await this.findOrCreateInternalNetwork();

    log(`Getting self container id...`);
    const selfContainerId = (await fs.readFile(
      "/etc/hostname",
      "utf-8"
    )).replace("\n", "");
    log(`Self container id: ${selfContainerId}!`);

    this.thisContainer = await this.docker.container.get(selfContainerId);

    try {
      await this.internalNetwork.connect({
        container: this.thisContainer.id
      });
      log(`Connected tunner container to the network!`);
    } catch (ex) {
      log(`Tunnel container was already connected to network!`);
    }

    log(`Checking existing containers if they're relevant...`);
    const containers = await this.docker.container.list();

    for (let c of containers) {
      const containerInfo = await this.getContainerInfo(c);

      if (!containerInfo) {
        continue;
      }

      if (await this.isContainerRelevant(containerInfo, true)) {
        log(`Found old relevant container(${c.id}) - attaching...`);
        this.onStartReleventContainer(containerInfo);
      }
    }
  }

  private initListeners() {
    log("Setting up event listeners...");
    this.dockerEventsListener.on(DockerEvent.Start, async data => {
      log(`Received DockerEvent.Start for container(${data.containerId})!`);

      const container = await this.getContainer(data.containerId);

      if (!container) {
        return;
      }

      const containerInfo = await this.getContainerInfo(container);

      if (!containerInfo) {
        return;
      }

      if (!(await this.isContainerRelevant(containerInfo))) {
        return;
      }

      return this.onStartReleventContainer(containerInfo);
    });

    this.dockerEventsListener.on(DockerEvent.Die, async data => {
      log(`Received DockerEvent.Die for container(${data.containerId})!`);

      const container = await this.getContainer(data.containerId);

      if (!container) {
        return;
      }

      const containerInfo = await this.getContainerInfo(container);

      if (!containerInfo) {
        return;
      }

      if (!(await this.isContainerRelevant(containerInfo))) {
        return;
      }

      return this.onDieRelevantContainer(containerInfo);
    });
  }

  private containerIdToIP = new Map<string, string>();

  private async onStartReleventContainer(containerInfo: IContainerInfo) {
    log(`Relevent container(${containerInfo.id}) is being started...`);
    const virtualHosts = this.getVirtualHostDomains(containerInfo);

    const container = await this.getContainer(containerInfo.id);

    if (!container) {
      return;
    }

    await this.fixContainerNetwork(container);
    const containerIP = await this.getContainerIP(container);
    this.containerIdToIP.set(container.id, containerIP);

    for (let virtualHost of virtualHosts) {
      const proxiedContainer = new ProxiedContainer(containerInfo.id, {
        options: {
          domain: virtualHost,
          containerPort: this.getVirtualHostPort(containerInfo),
          letsEncryptEmail: this.getLetsEncryptEmail(containerInfo),
          httpsMethod: this.getHttpsMethod(containerInfo),
          ezProxyPriority: this.getEzProxyPriority(containerInfo),
          basicAuthOptions: this.getBasicAuthOptions(containerInfo)
        },
        state: {
          ip: containerIP
        }
      });

      await this.reverseProxy.register(proxiedContainer);
    }
  }

  private async onDieRelevantContainer(containerInfo: IContainerInfo) {
    log(`Relevent container(${containerInfo.id}) is dying...`);

    await this.reverseProxy.unregister(containerInfo.id);
  }

  private async getContainer(containerId: string): Promise<Container | null> {
    try {
      return await this.docker.container.get(containerId);
    } catch (ex) {
      return null;
    }
  }

  private async getContainerInfo(
    container: Container
  ): Promise<IContainerInfo | null> {
    const status = await container.status();

    const env: KeyValueStore = ((status as any)!.data!.Config!.Env || [])
      .map((line: string) => {
        const parts = line.split("=");
        return {
          [parts[0]]: parts[1]
        };
      })
      .reduce((obj: any, a: any) => Object.assign(obj, a), {});

    const labels: KeyValueStore = (status as any)!.data!.Config!.Labels || {};

    return {
      id: container.id,
      env,
      labels
    };
  }

  private async isContainerRelevant(
    containerInfo: IContainerInfo,
    skipLogging: boolean = false
  ): Promise<boolean> {
    if (!containerInfo) {
      !skipLogging &&
        log(
          `Container is not relevant because containerInfo(${containerInfo}) is invalid!`
        );
      return false;
    }

    if (!containerInfo.env["VIRTUAL_HOST"]) {
      !skipLogging &&
        log(
          `Container(${
            containerInfo.id
          }) is not relevant because VIRTUAL_HOST is not set!`
        );
      return false;
    }

    return true;
  }

  private getVirtualHostDomains(containerInfo: IContainerInfo): string[] {
    return containerInfo.env["VIRTUAL_HOST"].split(",");
  }

  private getVirtualHostPort(containerInfo: IContainerInfo): number {
    const virtualPort = parseInt(containerInfo.env["VIRTUAL_PORT"]) || 80;

    return virtualPort;
  }

  private getLetsEncryptEmail(containerInfo: IContainerInfo): string | null {
    return containerInfo.env["LETSENCRYPT_EMAIL"] || null;
  }

  private getEzProxyPriority(containerInfo: IContainerInfo): number {
    const priority = parseInt(containerInfo.env["EZ_PROXY_PRIORITY"]);

    return Number.isNaN(priority) ? 10 : priority;
  }

  private getBasicAuthOptions(
    containerInfo: IContainerInfo
  ): IBasicAuthOptions | null {
    const {
      BASIC_AUTH = "",
      BASIC_AUTH_COOKIE = "__ez_proxy_service_basic_auth__"
    } = containerInfo.env;

    const [username, password] = BASIC_AUTH.split(":");

    return username && password
      ? {
          username,
          password,
          cookieName: BASIC_AUTH_COOKIE
        }
      : null;
  }

  private getHttpsMethod(containerInfo: IContainerInfo): HttpsMethod {
    const httpsMethod = containerInfo.env["HTTPS_METHOD"] as HttpsMethod;

    return isValidEnum(HttpsMethod, httpsMethod as HttpsMethod)
      ? httpsMethod
      : HttpsMethod.Default;
  }

  private async findOrCreateInternalNetwork(): Promise<Network> {
    const networkName = "MY_PROXY_NETWORK";

    const list = await this.docker.network.list();
    for (let network of list) {
      if ((network as any).data.Name === networkName) {
        log(`Found network!`);
        return network;
      }
    }

    log(`Creating new network...`);
    return await this.docker.network.create({
      Name: networkName
    });
  }

  private async waitForNetworkToBeReady() {
    while (true) {
      if (this.internalNetwork) {
        return;
      }
      await sleep(10);
    }
  }

  private async fixContainerNetwork(container: Container): Promise<void> {
    log(`Fixing container(${container.id}) network...`);
    await this.waitForNetworkToBeReady();

    try {
      await this.internalNetwork.connect({
        container: container.id
      });
    } catch (ex) {
      log(`Container(${container.id}) alrady had correct network!`);
    }
  }

  private async getContainerIP(container: Container): Promise<string> {
    let ip: string = "";

    const status = await container.status();

    while (true) {
      try {
        const { address } = await dnsLookup(
          (status as any).data.Config.Hostname
        );
        ip = address;
        break;
      } catch (ex) {
        log(`DNSLookup threw an error!`, ex);
        await sleep(100);
      }
    }
    return ip;
  }
}
