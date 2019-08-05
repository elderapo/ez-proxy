require("dotenv").config();

import { Docker } from "node-docker-api";
import { ContainersManager } from "./ContainersManager";
import { GlobalSharedBasicAuth } from "./auth";
import { ReverseProxy } from "./ReverseProxy";

const main = async () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  const {
    GLOBAL_BASIC_AUTH_USERNAME,
    GLOBAL_BASIC_AUTH_PASSWORD,
    GLOBAL_BASIC_AUTH_COOKIE_NAME
  } = process.env;

  const globalBasicAuth =
    GLOBAL_BASIC_AUTH_USERNAME && GLOBAL_BASIC_AUTH_PASSWORD
      ? new GlobalSharedBasicAuth({
          username: GLOBAL_BASIC_AUTH_USERNAME,
          password: GLOBAL_BASIC_AUTH_PASSWORD,
          cookieName:
            GLOBAL_BASIC_AUTH_COOKIE_NAME || "__ez_shared_basic_auth__"
        })
      : null;

  const reverseProxy = new ReverseProxy({
    globalBasicAuth
  });

  new ContainersManager(docker, reverseProxy);
};

main();
