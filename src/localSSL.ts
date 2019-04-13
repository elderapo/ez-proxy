import * as fs from "fs-extra";
import * as path from "path";
import * as sslValidator from "ssl-validator";
import { exec } from "./utils";

export interface ISSLInfo {
  key: string;
  cert: string;
  ca?: string;
}

export const generateLocalSSL = async (domain: string): Promise<ISSLInfo> => {
  const dir = path.join(__dirname, "..", ".certificates", domain);

  await fs.ensureDir(dir);

  const info: ISSLInfo = {
    key: path.join(dir, `privkey.pem`),
    cert: path.join(dir, `cert.pem`)
  };

  if ((await fs.pathExists(info.key)) && (await fs.pathExists(info.cert))) {
    const certContent = await fs.readFile(info.cert);
    const keyContent = await fs.readFile(info.key);

    if (await sslValidator.validateCertKeyPair(certContent, keyContent)) {
      // certificate is ok, no need to renew or anuthing
      return info;
    }
  }

  await exec(
    `openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout ${
      info.key
    } -out ${info.cert} -subj '/CN=${domain}'`
  );

  return info;
};
