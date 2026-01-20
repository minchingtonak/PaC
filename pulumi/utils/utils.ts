import * as pulumi from '@pulumi/pulumi';

export function checkForMissingVariables(args: pulumi.ResourceHookArgs) {
  const outputs = args.newOutputs as { stderr: string };

  const missingVars = outputs.stderr
    .split('\n')
    .filter((line) => line.includes('variable is not set'));

  if (missingVars.length) {
    throw new Error('\n' + missingVars.join('\n'));
  }
}
