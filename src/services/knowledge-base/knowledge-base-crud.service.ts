import { BaseService } from '@/services/app/base.service';
import { KnowledgeBaseQueryService, type KnowledgeBaseQueryInterface, type QueryingOptions } from '@/services/knowledge-base/knowledge-base-query.service';
import { KnowledgeBaseTrainingService } from '@/services/knowledge-base/knowledge-base-training.service';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';
import { FileEntity } from '@/db/entities/file.entity';

import { Container, Singleton } from 'typescript-ioc';
import _ from 'lodash';

export interface KnowledgeBaseFormInterface {
  title: string;
  content: string;
  files?: FileEntity[];
}

export interface KnowledgeBasePartialFormInterface {
  title?: string;
  content?: string;
  files?: FileEntity[];
}

export interface KnowledgeBasePageInterface {
  items: KnowledgeBaseEntity[];
  count: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

@Singleton
export class KnowledgeBaseCrudService extends BaseService {
  private readonly knowledgeBaseQueryService = Container.get(KnowledgeBaseQueryService);

  private readonly knowledgeBaseTrainingService = Container.get(KnowledgeBaseTrainingService);

  public findOne = async (id: number, options?: QueryingOptions & { withDeleted?: boolean }): Promise<KnowledgeBaseEntity> => {
    const builder = this.knowledgeBaseQueryService
      .createQueryBuilder({ ...(options || {}), includeIds: [id] });

    const knowledgeBase = await builder.getOne();
    if (!knowledgeBase) {
      throw new Error(`Знание №${id} не найдено`);
    }

    return knowledgeBase;
  };

  public findMany = async (query?: KnowledgeBaseQueryInterface, options?: QueryingOptions): Promise<KnowledgeBasePageInterface> => {
    const limit = query?.limit || DEFAULT_LIMIT;
    const offset = query?.offset ?? DEFAULT_OFFSET;

    const idsBuilder = this.knowledgeBaseQueryService
      .createQueryBuilder({
        ...(query || {}),
        manager: options?.manager,
        select: ['id'],
      });

    idsBuilder.limit(limit).offset(offset);

    this.knowledgeBaseQueryService.applyExcludeIdsFilter(idsBuilder, query?.excludeIds);
    this.knowledgeBaseQueryService.applyIncludeIdsFilter(idsBuilder, query?.includeIds);

    const [onlyWithIds, count] = await idsBuilder.getManyAndCount();

    if (!onlyWithIds?.length || _.isEqual(query?.select, ['id'])) {
      return {
        limit,
        offset,
        count,
        items: onlyWithIds,
      };
    }

    const fullBuilder = this.knowledgeBaseQueryService.createQueryBuilder({
      ...(query || {}),
      manager: options?.manager,
    });

    this.knowledgeBaseQueryService.applyIncludeIdsFilter(fullBuilder, onlyWithIds.map(({ id }) => id));
    this.knowledgeBaseQueryService.applySorting(fullBuilder, query?.sort);

    const items = await fullBuilder.getMany();

    return {
      limit,
      offset,
      count,
      items,
    };
  };

  public createOne = async (body: KnowledgeBaseFormInterface, options?: QueryingOptions): Promise<{ knowledge: KnowledgeBaseEntity | undefined; totalContentLength: number }> => {
    const created = await this.knowledgeBaseTrainingService.addDocumentToKnowledgeBase(body, options);
    const first = created[0];
    const totalContentLength = created.reduce((sum, entity) => sum + entity.content.length, 0);
    return { knowledge: first, totalContentLength };
  };

  public updateOne = async (id: number, body: KnowledgeBaseFormInterface, options?: QueryingOptions): Promise<KnowledgeBaseEntity | null> => {
    const manager = options?.manager || this.databaseService.getManager();
    const before = await this.findOne(id, { ...(options || {}), manager });

    return this.knowledgeBaseTrainingService.updateDocumentToKnowledgeBase(before, body, options);
  };

  public partialUpdateOne = async (id: number, body: KnowledgeBasePartialFormInterface, options?: QueryingOptions): Promise<KnowledgeBaseEntity | null> => {
    const manager = options?.manager || this.databaseService.getManager();
    const before = await this.findOne(id, { ...(options || {}), manager });

    const updatedData: KnowledgeBasePartialFormInterface = {};

    if (!_.isUndefined(body.title)) {
      updatedData.title = body.title;
    }
    if (!_.isUndefined(body.content)) {
      updatedData.content = body.content;
    }
    if (!_.isUndefined(body.files)) {
      updatedData.files = body.files;
    }

    if (_.isEmpty(updatedData)) {
      return before;
    }

    return this.knowledgeBaseTrainingService.updateDocumentToKnowledgeBase(before, updatedData, options);
  };

  public deleteOne = async (id: number, options?: QueryingOptions): Promise<KnowledgeBaseEntity> => {
    const knowledgeBase = await this.findOne(id, options);

    const manager = options?.manager || this.databaseService.getManager();
    await manager
      .getRepository(KnowledgeBaseEntity)
      .softDelete({ id });
    knowledgeBase.deleted = new Date();

    return knowledgeBase;
  };

  public restoreOne = async (id: number, options?: QueryingOptions): Promise<KnowledgeBaseEntity> => {
    const knowledgeBase = await this.findOne(id, {
      ...(options || {}),
      withDeleted: true,
    });
    if (!knowledgeBase.deleted) {
      return knowledgeBase;
    }

    const manager = options?.manager || this.databaseService.getManager();
    await manager
      .getRepository(KnowledgeBaseEntity)
      .recover({ id });
    knowledgeBase.deleted = undefined as unknown as Date;

    return knowledgeBase;
  };
}
