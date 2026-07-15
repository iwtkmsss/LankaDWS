import { Module } from '@nestjs/common'
import { EmployeesController } from './employees.controller.js'

@Module({ controllers: [EmployeesController] })
export class EmployeesModule {}
