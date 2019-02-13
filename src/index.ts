require("dotenv").config();

import { Docker } from "node-docker-api";
import { ContainersManager } from "./ContainersManager";
import { ProxyAuth } from "./ProxyAuth";
import { ReverseProxy } from "./ReverseProxy";

const main = async () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  const { BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD } = process.env;

  const auth = new ProxyAuth(BASIC_AUTH_USERNAME, BASIC_AUTH_PASSWORD);
  const reverseProxy = new ReverseProxy(auth);

  new ContainersManager(docker, reverseProxy);
};

main();
