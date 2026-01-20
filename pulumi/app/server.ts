import * as pulumi from '@pulumi/pulumi';
import * as hcloud from '@pulumi/hcloud';
import * as command from '@pulumi/command';
import { SERVER_USERNAME } from './constants';

export function generateCloudInit(
  sshPublicKey: pulumi.Output<string>,
  vpsDomain: pulumi.Output<string>,
): pulumi.Output<string> {
  return pulumi.all([sshPublicKey, vpsDomain]).apply(
    ([publicKey, domain]) => `#cloud-config
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
  );
}

const SERVER_DEFAULT_SPECS = {
  serverType: 'cpx11',
  location: 'ash',
  image: 'docker-ce',
  backups: false,
  shutdownBeforeDeletion: true,
} as const;

export function createServer(
  firewall: hcloud.Firewall,
  cloudInit: pulumi.Output<string>,
): hcloud.Server {
  return new hcloud.Server(
    'pangolin-server',
    {
      name: 'pangolin-server',
      ...SERVER_DEFAULT_SPECS,
      userData: cloudInit,
      firewallIds: [firewall.id.apply(Number)],
    },
    { dependsOn: firewall },
  );
}

export function initializeServer(
  server: hcloud.Server,
  sshPrivateKey: pulumi.Output<string>,
): command.remote.Command {
  const connection: command.types.input.remote.ConnectionArgs = {
    host: server.ipv4Address,
    user: SERVER_USERNAME,
    privateKey: sshPrivateKey,
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

  return rebootCommand;
}
