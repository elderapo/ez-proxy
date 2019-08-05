import * as acme from "acme-client";
import * as dateFns from "date-fns";
import * as fsExtra from "fs-extra";
import * as http from "http";
import * as path from "path";
import * as tls from "tls";
import {
  checkCertificateExpiration,
  dnsLookup,
  getPublicIP,
  isDomainLocal,
  mkcert
} from "./utils";
import * as Debug from "debug";

export interface ISSLInfo {
  key: Buffer;
  cert: Buffer;
  ca?: Buffer;
}

const log = Debug("SSLManager");

export class SSLManager {
  private acmeClient;
  private acmeChallenges = new Map<string, string>();
  private sslInfoFSCahce = new Map<string, ISSLInfo>();

  constructor() {
    this.initalize();
  }

  private async initalize(): Promise<void> {
    log(`Initializing ACME Client...`);
    this.acmeClient = new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: await acme.forge.createPrivateKey()
    });

    setInterval(() => {
      this.sslInfoFSCahce = new Map();
    }, 1000 * 60 * 5);
  }

  public getAcmeResponse(req: http.IncomingMessage): string | null {
    const regexpResult = req.url.match(/\.well-known\/acme-challenge\/(.*)/);

    if (!regexpResult) {
      return null;
    }

    const token = this.acmeChallenges.get(regexpResult[1]);

    return token;
  }

  public async getSSLSecureContext(
    domain: string,
    letsEncryptEmail?: string
  ): Promise<tls.SecureContext> {
    const sslInfo = await this.getValidSLLInfo(domain, letsEncryptEmail);

    return tls.createSecureContext(sslInfo);
  }

  private async isLocal(domain: string): Promise<boolean> {
    const publicIP = await getPublicIP();

    const { address } = await dnsLookup(domain);

    if (address === publicIP) {
      return false;
    }

    return isDomainLocal(domain);
  }

  private async getValidSLLInfo(
    domain: string,
    letsEncryptEmail?: string
  ): Promise<ISSLInfo> {
    const fromFS = await this.getSLLInfoFromFileSystem(domain);

    if (fromFS) {
      if (!(await this.isExpired(fromFS))) {
        return fromFS;
      }
    }

    if (await this.isLocal(domain)) {
      return await this.generateLocalSSL(domain);
    }

    return await this.generateLetsEncryptSSL(domain, letsEncryptEmail);
  }

  private async getSLLInfoFromFileSystem(
    domain: string
  ): Promise<ISSLInfo | null> {
    if (this.sslInfoFSCahce.has(domain)) {
      return this.sslInfoFSCahce.get(domain);
    }

    const dir = this.getDomainCertDir(domain);

    if (!(await fsExtra.existsSync(dir))) {
      return null;
    }

    const paths = {
      key: path.join(dir, `privkey.pem`),
      cert: path.join(dir, `cert.pem`)
    };

    const certs = {
      key: await fsExtra.readFile(paths.key),
      cert: await fsExtra.readFile(paths.cert)
    };

    this.sslInfoFSCahce.set(domain, certs);

    return certs;
  }

  private async generateLocalSSL(domain: string): Promise<ISSLInfo> {
    log(`Generating SSL certificate for local domain(${domain})...`);
    const dir = this.getDomainCertDir(domain);

    await fsExtra.ensureDir(dir);

    const paths = {
      key: path.join(dir, `privkey.pem`),
      cert: path.join(dir, `cert.pem`)
    };

    const command = `-cert-file "${paths.cert}" -key-file "${
      paths.key
    }" ${domain}`;

    await mkcert(command);

    log(`Generated SSL certificate for local domain(${domain})!`);

    return {
      key: await fsExtra.readFile(paths.key),
      cert: await fsExtra.readFile(paths.cert)
    };
  }

  private async generateLetsEncryptSSL(
    domain: string,
    letsEncryptEmail?: string
  ): Promise<ISSLInfo> {
    log(
      `Generating LE SSL certificate for normal domain(${domain}) letsEncryptEmail(${letsEncryptEmail})...`
    );
    const [key, csr] = await acme.forge.createCsr({
      commonName: domain
    });

    const cert = await this.acmeClient.auto({
      csr,
      email: letsEncryptEmail,
      termsOfServiceAgreed: true,
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        log(`Triggered challengeCreateFn() for domain(${domain})...`);

        /* http-01 */
        if (challenge.type === "http-01") {
          this.acmeChallenges.set(challenge.token, keyAuthorization);
        } else if (challenge.type === "dns-01") {
          log(`DNS acme challenge is not done!`);
          //   /* dns-01 */
          //   const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
          //   const recordValue = keyAuthorization;

          //   log(
          //     `Creating TXT record for ${authz.identifier.value}: ${dnsRecord}`
          //   );

          //   /* Replace this */
          //   log(
          //     `Would create TXT record "${dnsRecord}" with value "${recordValue}"`
          //   );
          //   // await dnsProvider.createRecord(dnsRecord, 'TXT', recordValue);
        }
      },
      challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
        log(`Triggered challengeRemoveFn() for domain(${domain})...`);

        /* http-01 */
        if (challenge.type === "http-01") {
          this.acmeChallenges.delete(challenge.token);
        } else if (challenge.type === "dns-01") {
          log(`DNS acme challenge is not done!`);
          //   /* dns-01 */
          //   const dnsRecord = `_acme-challenge.${authz.identifier.value}`;
          //   const recordValue = keyAuthorization;

          //   log(
          //     `Removing TXT record for ${authz.identifier.value}: ${dnsRecord}`
          //   );

          //   /* Replace this */
          //   log(
          //     `Would remove TXT record "${dnsRecord}" with value "${recordValue}"`
          //   );
          //   // await dnsProvider.removeRecord(dnsRecord, 'TXT');
        }
      }
    });

    const dir = this.getDomainCertDir(domain);

    await fsExtra.ensureDir(dir);

    await fsExtra.writeFile(path.join(dir, "cert.pem"), cert);
    await fsExtra.writeFile(path.join(dir, "privkey.pem"), key);

    log(
      `Generated LE SSL certificate for normal domain(${domain}) letsEncryptEmail(${letsEncryptEmail})!`
    );

    return {
      key: Buffer.from(key),
      cert: Buffer.from(cert)
    };
  }

  private getDomainCertDir(domain: string): string {
    const rootDir = path.join(__dirname, "..", ".certificates");
    const dir = path.join(rootDir, domain);

    return dir;
  }

  private async isExpired(info: ISSLInfo): Promise<boolean> {
    const expirationDate = await checkCertificateExpiration(info.cert);

    // Lets just mark ceritifaces with expiration date less than 7 as invalid - just in case...
    return dateFns.differenceInDays(expirationDate, new Date()) < 7;
  }
}
