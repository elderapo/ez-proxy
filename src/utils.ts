import * as dns from "dns";
import { promisify } from "util";
import * as publicIP from "public-ip";

export const sleep = promisify(setTimeout);

export const dnsLookup = promisify(dns.lookup);
export const dnsReverse = promisify(dns.reverse);

export const getPublicIP = async (): Promise<string> => await publicIP.v4();
