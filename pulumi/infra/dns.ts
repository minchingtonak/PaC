import * as pulumi from '@pulumi/pulumi';
import * as hcloud from '@pulumi/hcloud';
import * as porkbun from '@pulumi/porkbun';

export interface ServerDnsArgs {
  server: hcloud.Server;
  domain: pulumi.Input<string>;
  resourceIdPrefix: string;
  porkbunApiKey: pulumi.Input<string>;
  porkbunSecretKey: pulumi.Input<string>;
}

export class ServerDns extends pulumi.ComponentResource {
  public readonly baseDnsRecord: porkbun.DnsRecord;
  public readonly wildcardDnsRecord: porkbun.DnsRecord;
  public readonly provider: porkbun.Provider;

  constructor(
    name: string,
    args: ServerDnsArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('custom:infra:ServerDns', name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = {
      parent: this,
    };

    this.provider = new porkbun.Provider(
      `${args.resourceIdPrefix}-dns-domain-provider`,
      {
        apiKey: args.porkbunApiKey,
        secretKey: args.porkbunSecretKey,
      },
      defaultResourceOptions,
    );

    this.baseDnsRecord = new porkbun.DnsRecord(
      `${args.resourceIdPrefix}-dns-base-dns-record`,
      {
        domain: args.domain,
        content: args.server.ipv4Address,
        type: 'A',
      },
      {
        ...defaultResourceOptions,
        provider: this.provider,
        deleteBeforeReplace: true,
        dependsOn: [args.server],
      },
    );

    this.wildcardDnsRecord = new porkbun.DnsRecord(
      `${args.resourceIdPrefix}-dns-wildcard-dns-record`,
      {
        domain: args.domain,
        subdomain: '*',
        content: args.server.ipv4Address,
        type: 'A',
      },
      {
        ...defaultResourceOptions,
        provider: this.provider,
        deleteBeforeReplace: true,
        dependsOn: [args.server],
      },
    );

    this.registerOutputs({
      baseDnsRecord: this.baseDnsRecord,
      wildcardDnsRecord: this.wildcardDnsRecord,
    });
  }
}
