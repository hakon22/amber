import { Container, Singleton } from 'typescript-ioc';
import type { Router } from 'express';

import { BaseRouter } from '@/routes/base.route';
import { AnalyticsService } from '@/services/analytics/analytics.service';
import { LoggerService } from '@/services/app/logger.service';

@Singleton
export class AnalyticsRoute extends BaseRouter {
  private readonly analyticsService = Container.get(AnalyticsService);

  private readonly loggerService = Container.get(LoggerService);

  private readonly TAG = 'AnalyticsRoute';

  public set = (router: Router) => {
    router.get('/analytics/summary', async (req, res) => {
      try {
        const summary = await this.analyticsService.getSummary();
        res.json(summary);
      } catch (e) {
        this.loggerService.error(this.TAG, e);
        res.status(500).json({ error: 'Failed to load analytics' });
      }
    });
  };
}

