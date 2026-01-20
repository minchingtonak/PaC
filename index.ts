import * as pulumi from '@pulumi/pulumi';
import * as hcloud from '@pulumi/hcloud';
import * as porkbun from '@pulumi/porkbun';
import * as command from '@pulumi/command';
import { HandlebarsTemplateDirectory } from './pulumi/templates/handlebars-template-directory';
import { TemplateContext } from './pulumi/templates/template-context';
import { TemplateProcessor } from './pulumi/templates/template-processor';

function main() {
  const config = new pulumi.Config();
  const sshPrivateKeyAkmin = config.requireSecret('akmin#sshPrivateKey');
  const sshPublicKeyAkmin = config.requireSecret('akmin#sshPublicKey');
  const porkbunApiKey = config.requireSecret('porkbun#apiKey');
  const porkbunSecretKey = config.requireSecret('porkbun#secretKey');

  const vpsDomain = config.requireSecret('SECRET_DOMAIN');
  const acmeEmail = config.requireSecret('SECRET_ACME_EMAIL');

  const firewall = new hcloud.Firewall('firewall', {
    name: 'pangolin-firewall',
    rules: [
      {
        direction: 'in',
        protocol: 'tcp',
        port: '22',
        sourceIps: ['0.0.0.0/0', '::/0'],
      },
      {
        direction: 'in',
        protocol: 'tcp',
        port: '80',
        sourceIps: ['0.0.0.0/0', '::/0'],
      },
      {
        direction: 'in',
        protocol: 'tcp',
        port: '443',
        sourceIps: ['0.0.0.0/0', '::/0'],
      },
      {
        direction: 'in',
        protocol: 'tcp',
        port: '25570',
        sourceIps: ['0.0.0.0/0', '::/0'],
      },
      {
        direction: 'in',
        protocol: 'udp',
        port: '51820',
        sourceIps: ['0.0.0.0/0', '::/0'],
      },
      {
        direction: 'in',
        protocol: 'udp',
        port: '21820',
        sourceIps: ['0.0.0.0/0', '::/0'],
      },
    ],
  });

  // https://community.hetzner.com/tutorials/basic-cloud-config
  // https://github.com/tech-otaku/hetzner-cloud-init/blob/main/config.yaml
  const cloudInit = pulumi.all([sshPublicKeyAkmin, vpsDomain]).apply(
    ([publicKeyAkmin, vpsDomain]) => `#cloud-config
hostname: pangolin
fqdn: pangolin.${vpsDomain}
locale: en_US.UTF-8
timezone: America/New_York
users:
  - name: akmin
    groups: users, admin, docker
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - '${publicKeyAkmin}'
package_update: true
package_upgrade: true
package_reboot_if_required: false
write_files:
  - path: /etc/ssh/sshd_config.d/ssh-hardening.conf
    content: |
      PermitRootLogin no
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      ChallengeResponseAuthentication no
      MaxAuthTries 2
      AllowTcpForwarding no
      X11Forwarding no
      AllowAgentForwarding no
      AuthorizedKeysFile .ssh/authorized_keys
      AllowUsers akmin
`,
  );

  const server = new hcloud.Server(
    'pangolin-server',
    {
      name: 'pangolin-server',
      serverType: 'cpx11',
      location: 'ash', // Ashburn, VA
      image: 'docker-ce',
      userData: cloudInit,
      firewallIds: [firewall.id.apply(Number)],
      backups: false,
      shutdownBeforeDeletion: true,
    },
    { dependsOn: firewall },
  );

  const porkbunProvider = new porkbun.Provider('pangolin-domain-provider', {
    apiKey: porkbunApiKey,
    secretKey: porkbunSecretKey,
  });

  const baseRecord = new porkbun.DnsRecord(
    `base-dns-record`,
    {
      domain: vpsDomain,
      content: server.ipv4Address,
      type: 'A',
    },
    {
      provider: porkbunProvider,
      deleteBeforeReplace: true,
      dependsOn: server,
    },
  );

  const wildcardRecord = new porkbun.DnsRecord(
    `wildcard-dns-record`,
    {
      domain: vpsDomain,
      subdomain: '*',
      content: server.ipv4Address,
      type: 'A',
    },
    { provider: porkbunProvider, deleteBeforeReplace: true, dependsOn: server },
  );

  const connection: command.types.input.remote.ConnectionArgs = {
    host: server.ipv4Address,
    user: 'akmin',
    privateKey: sshPrivateKeyAkmin,
    dialErrorLimit: 30,
  };

  const waitForCloudInit = new command.remote.Command(
    'wait-for-cloud-init',
    {
      connection,
      create: 'cloud-init status --wait || [ $? -eq 2 ]',
    },
    { dependsOn: server },
  );

  const rebootCommand = new command.remote.Command(
    'reboot',
    {
      connection,
      create: 'sudo reboot',
    },
    { dependsOn: waitForCloudInit },
  );

  const createPangolinDir = new command.remote.Command(
    'create-pangolin-dir',
    {
      connection,
      create: 'mkdir -p ~/pangolin',
    },
    { dependsOn: rebootCommand },
  );

  const pangolinFiles = new pulumi.asset.FileArchive('./pangolin');

  const copyPangolinFiles = new command.remote.CopyToRemote(
    'copy-pangolin-files',
    {
      connection,
      source: pangolinFiles,
      remotePath: '/home/akmin',
      triggers: [createPangolinDir],
    },
    { dependsOn: createPangolinDir },
  );

  const stackEnv = {
    DOMAIN: vpsDomain,
    ACME_EMAIL: acmeEmail,
  };

  pulumi.all(stackEnv).apply((resolvedEnv) => {
    const renderedFiles = new HandlebarsTemplateDirectory(
      'pangolin-files-dir',
      {
        templateContext: new TemplateContext<typeof stackEnv>(resolvedEnv),
        templateDirectory: './pangolin',
      },
    );

    // copy rendered template files
    for (const [templatePath, templateFile] of Object.entries(
      renderedFiles.templateFiles,
    )) {
      const relativePath = TemplateProcessor.removeTemplateExtensions(
        templatePath.substring(templatePath.indexOf('pangolin')),
      );

      new command.remote.CopyToRemote(
        `copy-rendered-${templateFile.processedTemplate.idSafeName}`,
        {
          source: templateFile.asset.copyableSource,
          remotePath: `/home/akmin/${relativePath}`,
          connection,
        },
        {
          parent: renderedFiles,
          dependsOn: copyPangolinFiles,
        },
      );
    }

    const remoteStackDirectory = '~/pangolin';

    const deployStack = new command.remote.Command(
      'docker-compose-up',
      {
        create: [
          `cd ${remoteStackDirectory}`,
          'docker compose pull',
          `docker compose up -d --force-recreate`,
        ].join(' && '),
        update: [
          `cd ${remoteStackDirectory}`,
          'docker compose pull',
          `docker compose down --remove-orphans`,
          `docker compose up -d --force-recreate`,
          'docker image prune -a -f',
        ].join(' && '),
        delete: [
          `cd ${remoteStackDirectory}`,
          `docker compose down --remove-orphans`,
          'docker image prune -a -f',
        ].join(' && '),
        addPreviousOutputInEnv: false,
        triggers: [pangolinFiles],
        connection,
      },
      {
        dependsOn: copyPangolinFiles,
        deleteBeforeReplace: true,
        additionalSecretOutputs: ['stdout', 'stderr'],
      },
    );
  });
}

main();
