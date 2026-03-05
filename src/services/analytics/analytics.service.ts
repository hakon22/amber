import { IsNull, Not, type EntityManager } from 'typeorm';

import { Singleton } from 'typescript-ioc';
import { BaseService } from '@/services/app/base.service';
import { ResponseHistoryEntity } from '@/db/entities/response-history.entity';

export interface AnalyticsSummary {
  dailyQuestions: { date: string; count: number }[];
  successRate: number | null;
  averageResponseTimeMs: number | null;
  topTopics: { knowledgeId: number; title: string; count: number }[];
}

@Singleton
export class AnalyticsService extends BaseService {
  public getSummary = async (): Promise<AnalyticsSummary> => {
    const manager = this.databaseService.getManager();

    const [dailyQuestions, successRate, averageResponseTimeMs, topTopics] = await Promise.all([
      this.getDailyQuestions(manager),
      this.getSuccessRate(manager),
      this.getAverageResponseTime(manager),
      this.getTopTopics(manager),
    ]);

    return {
      dailyQuestions,
      successRate,
      averageResponseTimeMs,
      topTopics,
    };
  };

  private getDailyQuestions = async (manager: EntityManager): Promise<{ date: string; count: number }[]> => {
    const repo = manager.getRepository(ResponseHistoryEntity);

    const rows = await repo
      .createQueryBuilder('history')
      .select('DATE(history.created)', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('DATE(history.created)')
      .orderBy('DATE(history.created)', 'DESC')
      .limit(30)
      .getRawMany<{ date: string; count: string }>();

    return rows.map(r => ({
      date: r.date,
      count: Number.parseInt(r.count, 10),
    }));
  };

  private getSuccessRate = async (manager: EntityManager): Promise<number | null> => {
    const repo = manager.getRepository(ResponseHistoryEntity);
    
    const totalRated = await repo.count({
      where: {
        rating: Not(IsNull()),
      },
    });

    if (!totalRated) {
      return null;
    }

    const usefulCount = await repo.count({
      where: {
        rating: 'USEFUL',
      },
    });

    return usefulCount / totalRated;
  };

  private getAverageResponseTime = async (manager: EntityManager): Promise<number | null> => {
    const repo = manager.getRepository(ResponseHistoryEntity);

    const row = await repo
      .createQueryBuilder('history')
      .select('AVG(history.response_time_ms)', 'avg')
      .where('history.response_time_ms IS NOT NULL')
      .getRawOne<{ avg: string | null }>();

    if (!row?.avg) {
      return null;
    }

    return Number.parseFloat(row.avg);
  };

  private getTopTopics = async (manager: EntityManager): Promise<{ knowledgeId: number; title: string; count: number }[]> => {
    const rows = await manager.query<{ knowledgeId: number; title: string; count: string }[]>(
      `
        SELECT
          "knowledge"."id" AS "knowledgeId",
          "knowledge"."title" AS "title",
          COUNT(*) AS "count"
        FROM "response_history" AS "history"
        JOIN LATERAL unnest("history"."knowledge_ids") AS "kid" ON TRUE
        JOIN "knowledge_base" AS "knowledge" ON "knowledge"."id" = "kid"
        GROUP BY "knowledge"."id", "knowledge"."title"
        ORDER BY count DESC
        LIMIT 10
      `,
    );

    return rows.map(row => ({
      knowledgeId: row.knowledgeId,
      title: row.title,
      count: +row.count,
    }));
  };
}

