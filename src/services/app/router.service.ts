import { Singleton, Container } from 'typescript-ioc';
import express from 'express';

import { BaseRouter } from '@/routes/base.route';
import { IntegrationRoute } from '@/routes/integration/integration.route';
import { AnalyticsRoute } from '@/routes/analytics/analytics.route';
import { HealthRoute } from '@/routes/health/health.route';

@Singleton
export class RouterService extends BaseRouter {
  private readonly integrationRoute = Container.get(IntegrationRoute);

  private readonly analyticsRoute = Container.get(AnalyticsRoute);

  private readonly healthRoute = Container.get(HealthRoute);

  private router = express.Router();

  private routesArray = [
    this.integrationRoute,
    this.analyticsRoute,
    this.healthRoute,
  ];

  public set = () => this.routesArray.forEach((route) => route.set(this.router));

  public get = () => this.router;
}
