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
  PANGOLIN_STACK_PATH,
  SERVER_USER_HOME_DIR,
} from './constants';

const LOCAL_PANGOLIN_STACK_DIR = './pangolin';

export function deployApplication(
  server: hcloud.Server,
  sshPrivateKey: pulumi.Output<string>,
  vpsDomain: pulumi.Output<string>,
  acmeEmail: pulumi.Output<string>,
  dependsOn: pulumi.Resource,
): void {
  const connection: command.types.input.remote.ConnectionArgs = {
    host: server.ipv4Address,
    user: SERVER_USERNAME,
    privateKey: sshPrivateKey,
    dialErrorLimit: 30,
  };

  // Create remote directory
  const createPangolinDir = new command.remote.Command(
    'create-pangolin-dir',
    {
      connection,
      create: `mkdir -p ${PANGOLIN_STACK_PATH}`,
    },
    { dependsOn },
  );

  // Copy static files
  const pangolinFiles = new pulumi.asset.FileArchive(LOCAL_PANGOLIN_STACK_DIR);
  const copyPangolinFiles = new command.remote.CopyToRemote(
    'copy-pangolin-files',
    {
      connection,
      source: pangolinFiles,
      remotePath: SERVER_USER_HOME_DIR,
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
        templateDirectory: LOCAL_PANGOLIN_STACK_DIR,
      },
    );

    // Copy each rendered template file to the server
    for (const [templatePath, templateFile] of Object.entries(
      renderedFiles.templateFiles,
    )) {
      const relativePath = TemplateProcessor.removeTemplateExtensions(
        templatePath.substring(
          templatePath.indexOf(
            LOCAL_PANGOLIN_STACK_DIR.replaceAll(/[\.\/]/g, ''),
          ),
        ),
      );

      new command.remote.CopyToRemote(
        `copy-rendered-${templateFile.processedTemplate.idSafeName}`,
        {
          source: templateFile.asset.copyableSource,
          remotePath: `${SERVER_USER_HOME_DIR}/${relativePath}`,
          connection,
        },
        {
          parent: renderedFiles,
          dependsOn: copyPangolinFiles,
        },
      );
    }

    deployDockerStack(connection, pangolinFiles, copyPangolinFiles);
  });
}

function deployDockerStack(
  connection: command.types.input.remote.ConnectionArgs,
  pangolinFiles: pulumi.asset.FileArchive,
  copyPangolinFiles: command.remote.CopyToRemote,
): void {
  new command.remote.Command(
    'docker-compose-up',
    {
      create: [
        `cd ${PANGOLIN_STACK_PATH}`,
        'docker compose pull',
        'docker compose up -d --force-recreate',
      ].join(' && '),
      update: [
        `cd ${PANGOLIN_STACK_PATH}`,
        'docker compose pull',
        'docker compose down --remove-orphans',
        'docker compose up -d --force-recreate',
        'docker image prune -a -f',
      ].join(' && '),
      delete: [
        `cd ${PANGOLIN_STACK_PATH}`,
        'docker compose down --remove-orphans',
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
}
