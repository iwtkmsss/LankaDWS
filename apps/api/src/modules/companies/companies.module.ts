import { Module } from '@nestjs/common'
import { CompaniesController, CompanyDirectoryController } from './companies.controller.js'
import { CompaniesService } from './companies.service.js'
import { FilesModule } from '../files/files.module.js'

@Module({ imports: [FilesModule], controllers: [CompaniesController, CompanyDirectoryController], providers: [CompaniesService], exports: [CompaniesService] })
export class CompaniesModule {}
