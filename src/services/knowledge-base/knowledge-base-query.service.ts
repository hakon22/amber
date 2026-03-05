import { BaseService } from '@/services/app/base.service';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';

import { Singleton } from 'typescript-ioc';
import _ from 'lodash';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';

export interface KnowledgeBaseQueryInterface {
  limit?: number;
  offset?: number;
  includeIds?: number[];
  excludeIds?: number[];
  sort?: string;
  search?: string;
  select?: (keyof KnowledgeBaseEntity)[];
  withDeleted?: boolean;
}

export interface QueryingOptions {
  manager?: EntityManager;
  withDeleted?: boolean;
}

@Singleton
export class KnowledgeBaseQueryService extends BaseService {

  public static readonly DEFAULT_ALIAS = 'knowledge';

  public createQueryBuilder = (options?: KnowledgeBaseQueryInterface & QueryingOptions): SelectQueryBuilder<KnowledgeBaseEntity> => {
    const manager = options?.manager || this.databaseService.getManager();
    const alias = KnowledgeBaseQueryService.DEFAULT_ALIAS;

    const builder = manager
      .getRepository(KnowledgeBaseEntity)
      .createQueryBuilder(alias);

    if (options?.withDeleted) {
      builder.withDeleted();
    }

    if (options?.search) {
      builder.andWhere(
        `(${alias}.title ILIKE :search OR ${alias}.content ILIKE :search)`,
        { search: `%${options.search}%` },
      );
    }

    if (options?.sort) {
      this.applySorting(builder, options.sort);
    } else {
      builder.orderBy(`${alias}.id`, 'DESC');
    }

    return builder;
  };

  public applySearchFilter = async (query: KnowledgeBaseQueryInterface): Promise<[KnowledgeBaseEntity[], number]> => {
    const manager = this.databaseService.getManager();
    const alias = KnowledgeBaseQueryService.DEFAULT_ALIAS;

    const builder = manager
      .getRepository(KnowledgeBaseEntity)
      .createQueryBuilder(alias);

    if (query.search) {
      builder.andWhere(
        `(${alias}.title ILIKE :search OR ${alias}.content ILIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    this.applyIncludeIdsFilter(builder, query.includeIds);
    this.applyExcludeIdsFilter(builder, query.excludeIds);

    if (query.sort) {
      this.applySorting(builder, query.sort);
    } else {
      builder.orderBy(`${alias}.id`, 'DESC');
    }

    if (typeof query.limit === 'number') {
      builder.limit(query.limit);
    }
    if (typeof query.offset === 'number') {
      builder.offset(query.offset);
    }

    return builder.getManyAndCount();
  };

  public applyIncludeIdsFilter = (builder: SelectQueryBuilder<KnowledgeBaseEntity>, includeIds?: number[]): void => {
    if (includeIds?.length) {
      builder.andWhere(`${builder.alias}.id IN(:...includeIds)`, { includeIds: _.uniq(includeIds) });
    }
  };

  public applyExcludeIdsFilter = (builder: SelectQueryBuilder<KnowledgeBaseEntity>, excludeIds?: number[]): void => {
    if (excludeIds?.length) {
      builder.andWhere(`${builder.alias}.id NOT IN(:...excludeIds)`, { excludeIds: _.uniq(excludeIds) });
    }
  };

  public applySorting = (builder: SelectQueryBuilder<KnowledgeBaseEntity>, sort?: string): void => {
    if (!sort) {
      return;
    }

    const [column, rawOrder] = sort.split(',');
    const order = rawOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const alias = builder.alias;
    const columnPath = column.includes('.') ? column : `${alias}.${column}`;

    builder.orderBy(columnPath, order as 'ASC' | 'DESC');
  };
}
