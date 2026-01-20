import * as pulumi from '@pulumi/pulumi';
import * as hcloud from '@pulumi/hcloud';
import * as command from '@pulumi/command';
import { SERVER_USERNAME } from './constants';

const FIREWALL_RULES = [
  { port: '22', protocol: 'tcp', description: 'ssh' },
  { port: '80', protocol: 'tcp', description: 'http' },
  { port: '443', protocol: 'tcp', description: 'https' },
  { port: '25565', protocol: 'tcp', description: 'minecraft' },
  { port: '51820', protocol: 'udp', description: 'pangolin' },
  { port: '21820', protocol: 'udp', description: 'pangolin' },
];

const SERVER_DEFAULT_SPECS = {
  serverType: 'cpx11',
  location: 'ash',
  image: 'docker-ce',
  backups: false,
  shutdownBeforeDeletion: true,
} as const;

export interface ServerArgs {
  sshPublicKey: pulumi.Input<string>;
  vpsDomain: pulumi.Input<string>;
  resourceIdPrefix: string;
}

export class Server extends pulumi.ComponentResource {
  public readonly firewall: hcloud.Firewall;
  public readonly server: hcloud.Server;
  public readonly cloudInit: pulumi.Output<string>;

  constructor(
    name: string,
    private args: ServerArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('custom:infra:Server', name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = {
      parent: this,
    };

    // Create firewall
    const rules = FIREWALL_RULES.map(({ port, protocol }) => ({
      direction: 'in' as const,
      protocol,
      port,
      sourceIps: ['0.0.0.0/0', '::/0'],
    }));

    this.firewall = new hcloud.Firewall(
      `${args.resourceIdPrefix}-server-firewall`,
      {
        name: `${args.resourceIdPrefix}-firewall`,
        rules,
      },
      defaultResourceOptions,
    );

    // Generate cloud-init
    this.cloudInit = pulumi.output(args.sshPublicKey).apply((publicKey) =>
      pulumi.output(args.vpsDomain).apply(
        (domain) => `#cloud-config
hostname: pangolin
fqdn: pangolin.${domain}
locale: en_US.UTF-8
timezone: America/New_York
users:
  - name: akmin
    groups: users, admin, docker
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - '${publicKey}'
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
      ),
    );

    // Create server
    this.server = new hcloud.Server(
      `${args.resourceIdPrefix}-server`,
      {
        name: `${args.resourceIdPrefix}-server`,
        ...SERVER_DEFAULT_SPECS,
        userData: this.cloudInit,
        firewallIds: [this.firewall.id.apply(Number)],
      },
      {
        ...defaultResourceOptions,
        dependsOn: [this.firewall],
      },
    );

    this.registerOutputs({
      firewall: this.firewall,
      server: this.server,
      cloudInit: this.cloudInit,
    });
  }

  public initializeAndReboot(
    sshPrivateKey: pulumi.Input<string>,
  ): command.remote.Command {
    const connection: command.types.input.remote.ConnectionArgs = {
      host: this.server.ipv4Address,
      user: SERVER_USERNAME,
      privateKey: sshPrivateKey,
    };

    const waitForCloudInit = new command.remote.Command(
      `${this.args.resourceIdPrefix}-server-wait-for-cloud-init`,
      {
        connection,
        create: 'cloud-init status --wait || [ $? -eq 2 ]',
      },
      { parent: this, dependsOn: [this.server] },
    );

    const rebootCommand = new command.remote.Command(
      `${this.args.resourceIdPrefix}-server-reboot`,
      {
        connection,
        create: 'sudo reboot',
      },
      { parent: this, dependsOn: [waitForCloudInit] },
    );

    return rebootCommand;
  }
}
