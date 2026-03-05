import { ModelBaseService } from '@/services/model/model-base.service';
import { AgentEntity } from '@/db/entities/agent.entity';
import { KnowledgeBaseEntity } from '@/db/entities/knowledge-base.entity';

import { Singleton } from 'typescript-ioc';
import { In, type EntityManager } from 'typeorm';
import _ from 'lodash';

interface KnowledgeBaseOptions {
  manager?: EntityManager;
  limit?: number;
}

interface KnowledgeBaseRawResponseInterface {
  id: string;
  title: string;
  content: string;
  distance: string;
}

@Singleton
export class KnowledgeBaseService extends ModelBaseService {

  /**
   * Семантический поиск по базе знаний с использованием pgvector.
   *
   * @param agent   Агент, у которого настроена embedding‑модель
   * @param question Текст вопроса пользователя
   * @param options  Доп.опции (manager, limit)
   *
   * @returns `[знания, минимальная уверенность]`, где уверенность в диапазоне 0..1
   */
  public searchInKnowledgeBase = async (agent: AgentEntity, question: string, options?: KnowledgeBaseOptions): Promise<[KnowledgeBaseEntity[], number]> => {
    const manager = options?.manager || this.databaseService.getManager();

    if (!agent.isEmbedding) {
      return [[], 0];
    }

    const model = this.getEmbeddingModel(agent);

    const questionEmbedding = await model.embedQuery(question);

    const knowledgeBaseRepo = manager.getRepository(KnowledgeBaseEntity);
    const embeddingColumn = `embedding_${questionEmbedding.length}`;

    const builder = knowledgeBaseRepo
      .createQueryBuilder('knowledge')
      .setParameters({
        embedding: `[${questionEmbedding.join(',')}]`,
      })
      .select([
        '"knowledge"."id" AS "id"',
        '"knowledge"."title" AS "title"',
        '"knowledge"."content" AS "content"',
        `1 - ("knowledge"."${embeddingColumn}" <=> :embedding) AS "distance"`,
      ])
      .where('knowledge.deleted IS NULL')
      .andWhere(`"knowledge"."${embeddingColumn}" IS NOT NULL`)
      .orderBy('distance', 'DESC')
      .limit(options?.limit ?? 3);

    const similarKnowledges = await builder.getRawMany<KnowledgeBaseRawResponseInterface>();

    if (!similarKnowledges.length) {
      return [[], 0];
    }

    const similarIds = similarKnowledges.map(({ id }) => Number(id));

    const knowledges = await knowledgeBaseRepo.find({ select: ['id', 'content'], where: { id: In(similarIds) } });

    knowledges.sort((a, b) => {
      const aDistance = Number(similarKnowledges.find(({ id }) => Number(id) === a.id)?.distance || 0);
      const bDistance = Number(similarKnowledges.find(({ id }) => Number(id) === b.id)?.distance || 0);
      return bDistance - aDistance; // DESC порядок
    });

    const minConfidence = Number(_.minBy(similarKnowledges, ({ distance }) => Number(distance))?.distance || 0);

    return [knowledges, minConfidence];
  };
}