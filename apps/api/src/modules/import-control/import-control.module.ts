import { Module } from '@nestjs/common'
import { ImportControlController } from './import-control.controller.js'
import { ImportControlService } from './import-control.service.js'

@Module({ controllers: [ImportControlController], providers: [ImportControlService] })
export class ImportControlModule {}
