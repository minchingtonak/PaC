import * as pulumi from '@pulumi/pulumi';

interface Config {
  sshPrivateKeyAkmin: pulumi.Output<string>;
  sshPublicKeyAkmin: pulumi.Output<string>;
  porkbunApiKey: pulumi.Output<string>;
  porkbunSecretKey: pulumi.Output<string>;
  vpsDomain: pulumi.Output<string>;
  acmeEmail: pulumi.Output<string>;
}

export function loadConfiguration(): Config {
  const config = new pulumi.Config();

  return {
    sshPrivateKeyAkmin: config.requireSecret('akmin#sshPrivateKey'),
    sshPublicKeyAkmin: config.requireSecret('akmin#sshPublicKey'),
    porkbunApiKey: config.requireSecret('porkbun#apiKey'),
    porkbunSecretKey: config.requireSecret('porkbun#secretKey'),
    vpsDomain: config.requireSecret('SECRET_DOMAIN'),
    acmeEmail: config.requireSecret('SECRET_ACME_EMAIL'),
  };
}
