import * as pulumi from '@pulumi/pulumi';
import * as hcloud from '@pulumi/hcloud';
import * as porkbun from '@pulumi/porkbun';

export function setupDNS(
  server: hcloud.Server,
  vpsDomain: pulumi.Output<string>,
  porkbunApiKey: pulumi.Output<string>,
  porkbunSecretKey: pulumi.Output<string>,
): void {
  const porkbunProvider = new porkbun.Provider('pangolin-domain-provider', {
    apiKey: porkbunApiKey,
    secretKey: porkbunSecretKey,
  });

  new porkbun.DnsRecord(
    'base-dns-record',
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

  new porkbun.DnsRecord(
    'wildcard-dns-record',
    {
      domain: vpsDomain,
      subdomain: '*',
      content: server.ipv4Address,
      type: 'A',
    },
    {
      provider: porkbunProvider,
      deleteBeforeReplace: true,
      dependsOn: server,
    },
  );
}
