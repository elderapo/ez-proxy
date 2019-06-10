import { sleep } from "../utils";

export const main = async () => {
  console.log("RUNNING TESTS...");

  await sleep(500);

  console.log("TESTS DONE");

  process.exit(0);
};

main();
