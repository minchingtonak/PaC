import {
  loadConfiguration,
  createFirewall,
  generateCloudInit,
  createServer,
  setupDNS,
  initializeServer,
  deployApplication,
} from './pulumi';

function main() {
  const config = loadConfiguration();

  const firewall = createFirewall();
  const cloudInit = generateCloudInit(
    config.sshPublicKeyAkmin,
    config.vpsDomain,
  );
  const server = createServer(firewall, cloudInit);

  setupDNS(
    server,
    config.vpsDomain,
    config.porkbunApiKey,
    config.porkbunSecretKey,
  );

  const rebootCommand = initializeServer(server, config.sshPrivateKeyAkmin);

  deployApplication(
    server,
    config.sshPrivateKeyAkmin,
    config.vpsDomain,
    config.acmeEmail,
    rebootCommand,
  );
}

main();
