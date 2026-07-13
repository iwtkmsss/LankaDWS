import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import type { HealthCheck } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getApiInfo() {
    return this.appService.getApiInfo();
  }

  @Get('health')
  getHealth(): HealthCheck {
    return this.appService.getHealth();
  }
}
