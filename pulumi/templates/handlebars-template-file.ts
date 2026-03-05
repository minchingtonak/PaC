import * as pulumi from '@pulumi/pulumi';
import { RenderedTemplateFile, TemplateProcessor } from './template-processor';
import { TemplateContext } from './template-context';

export type HandlebarsTemplateFileArgs<
  TContext extends Record<string, unknown>,
> = {
  templatePath: string;
  configNamespace?: string;
  templateContext: TemplateContext<TContext>;
};

export class HandlebarsTemplateFile<
  TContext extends Record<string, unknown> = Record<string, unknown>,
>
  extends pulumi.ComponentResource
{
  public static RESOURCE_TYPE = 'HaC:templates:HandlebarsTemplateFile';

  processedTemplate: RenderedTemplateFile;

  asset: pulumi.Output<pulumi.asset.StringAsset>;

  constructor(
    name: string,
    args: HandlebarsTemplateFileArgs<TContext>,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super(HandlebarsTemplateFile.RESOURCE_TYPE, name, {}, opts);

    this.processedTemplate = TemplateProcessor.processTemplate(
      args.templatePath,
      new pulumi.Config(args.configNamespace),
      args.templateContext.get(),
    );

    this.asset = this.processedTemplate.content.apply(
      (val) => new pulumi.asset.StringAsset(val),
    );

    this.registerOutputs();
  }
}
