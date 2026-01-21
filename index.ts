import { loadConfiguration, ServerDns, AppDeployment, Server } from './pulumi';

function main() {
  const config = loadConfiguration();

  const server = new Server('pangolin-server', {
    sshPublicKey: config.sshPublicKeyAkmin,
    vpsDomain: config.vpsDomain,
    resourceIdPrefix: 'pangolin',
  });

  const dnsSetup = new ServerDns('pangolin-dns', {
    server: server.server,
    domain: config.vpsDomain,
    resourceIdPrefix: 'pangolin',
    porkbunApiKey: config.porkbunApiKey,
    porkbunSecretKey: config.porkbunSecretKey,
  });

  const rebootCommand = server.initializeAndReboot(config.sshPrivateKeyAkmin);

  const appDeployment = new AppDeployment('pangolin-app', {
    server: server.server,
    sshPrivateKey: config.sshPrivateKeyAkmin,
    stackName: 'pangolin',
    localStackDirectory: './pangolin',
    templateEnvironment: {
      DOMAIN: config.vpsDomain,
      ACME_EMAIL: config.acmeEmail,
    },
    dependsOn: rebootCommand,
  });
}

main();
