import * as got from "got";
import * as asyncRetry from "async-retry";

const client = got.extend({ rejectUnauthorized: false });

export const main = async () => {
  console.log("Starting tests...");

  const tests = [testBasicLookup, testLoadBalancing];

  for (let test of tests) {
    const testName = `Test(${test.name})`;

    console.log(`Starting ${testName}...`);

    await asyncRetry(test, {
      retries: 30,
      onRetry: (err, tryNumber) => {
        console.log(
          `${testName} failed with err: ${
            err.message
          }. Try number: ${tryNumber}`
        );
      }
    });
    console.log(`Successfully ran ${testName}!`);
  }

  process.exit(0);
};

const testBasicLookup = async () => {
  const response = await client.get("https://whoami1.loc");

  if (response.statusCode !== 200) {
    throw new Error(
      `Expected statusCode(200) received statusCode(${response.statusCode})!`
    );
  }

  if (response.body.indexOf(`I'm `) === -1) {
    throw new Error(
      `Expected body to contain "I'm " string. Received: "${response.body}"...`
    );
  }
};

const testLoadBalancing = async () => {
  const responsesPromises = Array(20)
    .fill(0)
    .map(() => client.get("https://whoami1.loc"));

  const responses = await Promise.all(responsesPromises);

  const unique = new Map<string, boolean>();

  for (const res of responses) {
    unique.set(res.body, true);
  }

  if (unique.size !== 3) {
    throw new Error(
      `There should be 3 entries in unique map but there are: ${unique.size}!`
    );
  }
};

main();
