import * as pulumi from '@pulumi/pulumi';
import * as hcloud from '@pulumi/hcloud';
import * as command from '@pulumi/command';
import {
  HandlebarsTemplateDirectory,
  TemplateContext,
  TemplateProcessor,
} from '../templates';
import {
  SERVER_USERNAME,
  SERVER_USER_HOME_DIR,
} from './constants';

export interface AppDeploymentArgs {
  server: hcloud.Server;
  sshPrivateKey: pulumi.Input<string>;
  stackName: string;
  localStackDirectory: string;
  templateEnvironment: Record<string, pulumi.Input<string>>;
  dependsOn: pulumi.Resource;
}

export class AppDeployment extends pulumi.ComponentResource {
  public readonly createStackDir: command.remote.Command;
  public readonly copyStackFiles: command.remote.CopyToRemote;
  public readonly dockerComposeUp: command.remote.Command;

  constructor(
    name: string,
    args: AppDeploymentArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('custom:infra:ApplicationDeployment', name, {}, opts);

    const defaultResourceOptions: pulumi.ResourceOptions = {
      parent: this,
    };

    const remoteStackPath = `${SERVER_USER_HOME_DIR}/${args.stackName}`;

    const connection: command.types.input.remote.ConnectionArgs = {
      host: args.server.ipv4Address,
      user: SERVER_USERNAME,
      privateKey: args.sshPrivateKey,
    };

    this.createStackDir = new command.remote.Command(
      `${args.stackName}-app-create-dir`,
      {
        connection,
        create: `mkdir -p ${remoteStackPath}`,
      },
      { ...defaultResourceOptions, dependsOn: args.dependsOn },
    );

    const stackFiles = new pulumi.asset.FileArchive(args.localStackDirectory);
    this.copyStackFiles = new command.remote.CopyToRemote(
      `${args.stackName}-app-copy-files`,
      {
        connection,
        source: stackFiles,
        remotePath: SERVER_USER_HOME_DIR,
        triggers: [this.createStackDir],
      },
      { ...defaultResourceOptions, dependsOn: this.createStackDir },
    );

    pulumi.all(args.templateEnvironment).apply((resolvedEnv) => {
      const renderedFiles = new HandlebarsTemplateDirectory(
        `${args.stackName}-app-files-dir`,
        {
          templateContext: new TemplateContext<
            typeof args.templateEnvironment
          >(resolvedEnv),
          templateDirectory: args.localStackDirectory,
        },
        defaultResourceOptions,
      );

      // Copy each rendered template file to the server
      for (const [templatePath, templateFile] of Object.entries(
        renderedFiles.templateFiles,
      )) {
        const relativePath = TemplateProcessor.removeTemplateExtensions(
          templatePath.substring(
            templatePath.indexOf(
              args.localStackDirectory.replaceAll(/[\.\/]/g, ''),
            ),
          ),
        );

        new command.remote.CopyToRemote(
          `${args.stackName}-app-copy-rendered-${templateFile.processedTemplate.idSafeName}`,
          {
            source: templateFile.asset.copyableSource,
            remotePath: `${SERVER_USER_HOME_DIR}/${relativePath}`,
            connection,
          },
          {
            parent: renderedFiles,
            dependsOn: this.copyStackFiles,
          },
        );
      }
    });

    this.dockerComposeUp = new command.remote.Command(
      `${args.stackName}-app-docker-compose-up`,
      {
        create: [
          `cd ${remoteStackPath}`,
          'docker compose pull',
          'docker compose up -d --force-recreate',
        ].join(' && '),
        update: [
          `cd ${remoteStackPath}`,
          'docker compose pull',
          'docker compose down --remove-orphans',
          'docker compose up -d --force-recreate',
          'docker image prune -a -f',
        ].join(' && '),
        delete: [
          `cd ${remoteStackPath}`,
          'docker compose down --remove-orphans',
          'docker image prune -a -f',
        ].join(' && '),
        addPreviousOutputInEnv: false,
        triggers: [stackFiles],
        connection,
      },
      {
        ...defaultResourceOptions,
        dependsOn: this.copyStackFiles,
        deleteBeforeReplace: true,
        additionalSecretOutputs: ['stdout', 'stderr'],
      },
    );

    this.registerOutputs({
      createStackDir: this.createStackDir,
      copyStackFiles: this.copyStackFiles,
      dockerComposeUp: this.dockerComposeUp,
    });
  }
}
