import { Module } from '@nestjs/common'
import { CompaniesController, CompanyDirectoryController } from './companies.controller.js'
import { CompaniesService } from './companies.service.js'

@Module({ controllers: [CompaniesController, CompanyDirectoryController], providers: [CompaniesService], exports: [CompaniesService] })
export class CompaniesModule {}
