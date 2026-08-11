import { Module } from '@nestjs/common'
import { UiPreferencesController } from './ui-preferences.controller.js'
import { UiPreferencesService } from './ui-preferences.service.js'

@Module({
  controllers: [UiPreferencesController],
  providers: [UiPreferencesService],
})
export class UiPreferencesModule {}

