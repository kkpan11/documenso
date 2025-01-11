import { omit } from 'remeda';
import type { z } from 'zod';

import { nanoid } from '@documenso/lib/universal/id';
import { prisma } from '@documenso/prisma';
import type { Prisma } from '@documenso/prisma/client';
import { TemplateSchema } from '@documenso/prisma/generated/zod';
import type { TDuplicateTemplateMutationSchema } from '@documenso/trpc/server/template-router/schema';

export type DuplicateTemplateOptions = TDuplicateTemplateMutationSchema & {
  userId: number;
  teamId?: number;
};

export const ZDuplicateTemplateResponseSchema = TemplateSchema;

export type TDuplicateTemplateResponse = z.infer<typeof ZDuplicateTemplateResponseSchema>;

export const duplicateTemplate = async ({
  templateId,
  userId,
  teamId,
}: DuplicateTemplateOptions): Promise<TDuplicateTemplateResponse> => {
  const template = await prisma.template.findUnique({
    where: {
      id: templateId,
      ...(teamId
        ? {
            team: {
              id: teamId,
              members: {
                some: {
                  userId,
                },
              },
            },
          }
        : {
            userId,
            teamId: null,
          }),
    },
    include: {
      Recipient: true,
      Field: true,
      templateDocumentData: true,
      templateMeta: true,
    },
  });

  if (!template) {
    throw new Error('Template not found.');
  }

  const documentData = await prisma.documentData.create({
    data: {
      type: template.templateDocumentData.type,
      data: template.templateDocumentData.data,
      initialData: template.templateDocumentData.initialData,
    },
  });

  let templateMeta: Prisma.TemplateCreateArgs['data']['templateMeta'] | undefined = undefined;

  if (template.templateMeta) {
    templateMeta = {
      create: {
        ...omit(template.templateMeta, ['id', 'templateId']),
        emailSettings: template.templateMeta.emailSettings || undefined,
      },
    };
  }

  const duplicatedTemplate = await prisma.template.create({
    data: {
      userId,
      teamId,
      title: template.title + ' (copy)',
      templateDocumentDataId: documentData.id,
      Recipient: {
        create: template.Recipient.map((recipient) => ({
          email: recipient.email,
          name: recipient.name,
          token: nanoid(),
        })),
      },
      templateMeta,
    },
    include: {
      Recipient: true,
    },
  });

  await prisma.field.createMany({
    data: template.Field.map((field) => {
      const recipient = template.Recipient.find((recipient) => recipient.id === field.recipientId);

      const duplicatedTemplateRecipient = duplicatedTemplate.Recipient.find(
        (doc) => doc.email === recipient?.email,
      );

      if (!duplicatedTemplateRecipient) {
        throw new Error('Recipient not found.');
      }

      return {
        type: field.type,
        page: field.page,
        positionX: field.positionX,
        positionY: field.positionY,
        width: field.width,
        height: field.height,
        customText: field.customText,
        inserted: field.inserted,
        templateId: duplicatedTemplate.id,
        recipientId: duplicatedTemplateRecipient.id,
      };
    }),
  });

  return duplicatedTemplate;
};
