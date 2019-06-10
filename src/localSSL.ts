import * as fs from "fs-extra";
import * as path from "path";
import { mkcert } from "./utils";

export interface ISSLInfo {
  key: string;
  cert: string;
}

export const generateLocalSSL = async (domain: string): Promise<ISSLInfo> => {
  const rootDir = path.join(__dirname, "..", ".certificates");
  const dir = path.join(rootDir, domain);

  await fs.ensureDir(dir);

  const info: ISSLInfo = {
    key: path.join(dir, `privkey.pem`),
    cert: path.join(dir, `cert.pem`)
  };

  const command = `-cert-file "${info.cert}" -key-file "${info.key}" ${domain}`;

  await mkcert(command);

  return info;
};
