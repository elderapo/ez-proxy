import * as dns from "dns";
import { promisify } from "util";

export const sleep = promisify(setTimeout);

export const dnsLookup = promisify(dns.lookup);
