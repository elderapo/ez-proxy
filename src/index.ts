import { Docker } from "node-docker-api";
import { ContainersManager } from "./ContainersManager";

const main = async () => {
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  new ContainersManager(docker);
};

main();
