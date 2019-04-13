import * as fs from "fs-extra";
import * as path from "path";
import * as sslValidator from "ssl-validator";
import { exec, sleep } from "./utils";

export interface ISSLInfo {
  key: string;
  cert: string;
  ca?: string;
  csr?: string;
}

export const generateLocalSSL = async (domain: string): Promise<ISSLInfo> => {
  const rootDir = path.join(__dirname, "..", ".certificates");
  const dir = path.join(rootDir, domain);

  await fs.ensureDir(dir);

  const info: ISSLInfo = {
    key: path.join(dir, `privkey.pem`),
    cert: path.join(dir, `cert.pem`),
    csr: path.join(dir, "signing.csr")
  };

  const rootCACrt = path.join(rootDir, ".root", "rootCA.crt");
  const rootCAKey = path.join(rootDir, ".root", "rootCA.key");

  await exec(`openssl genrsa -out ${info.key} 2048`);

  await exec(
    `openssl req -new -sha256 -key ${info.key} -subj '/CN=${domain}' -out ${
      info.csr
    }`
  );

  const command = `openssl req -new -sha256 -key ${
    info.key
  } -subj "/C=US/ST=CA/O=Ez-proxy, Inc./CN=${domain}" -reqexts SAN -extensions SAN -config <(cat /etc/ssl/openssl.cnf <(printf "[SAN]\nsubjectAltName=DNS:${domain},DNS:*.${domain}")) -out ${
    info.csr
  }`;

  await exec(`bash -c '${command}'`);

  await exec(
    `openssl x509 -req -in ${
      info.csr
    } -CA ${rootCACrt} -CAkey ${rootCAKey} -CAcreateserial -out ${
      info.cert
    } -days 3650 -sha256`
  );

  return info;
};
