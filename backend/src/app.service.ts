import { Injectable } from '@nestjs/common';

export type HealthCheck = {
  name: string;
  status: 'ok';
  timestamp: string;
  uptime: number;
};

@Injectable()
export class AppService {
  getApiInfo() {
    return {
      name: 'BertCRM API',
      message: 'NestJS API is ready.',
    };
  }

  getHealth(): HealthCheck {
    return {
      name: 'BertCRM API',
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
