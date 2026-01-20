import * as hcloud from '@pulumi/hcloud';

const FIREWALL_RULES = [
  { port: '22', protocol: 'tcp', description: 'ssh' },
  { port: '80', protocol: 'tcp', description: 'http' },
  { port: '443', protocol: 'tcp', description: 'https' },
  { port: '25565', protocol: 'tcp', description: 'minecraft' },
  { port: '51820', protocol: 'udp', description: 'pangolin' },
  { port: '21820', protocol: 'udp', description: 'pangolin' },
];

export function createFirewall(): hcloud.Firewall {
  const rules = FIREWALL_RULES.map(({ port, protocol }) => ({
    direction: 'in',
    protocol,
    port,
    sourceIps: ['0.0.0.0/0', '::/0'],
  }));

  return new hcloud.Firewall('firewall', {
    name: 'pangolin-firewall',
    rules,
  });
}
