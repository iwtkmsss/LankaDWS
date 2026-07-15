import { Module } from '@nestjs/common'
import { CalendarController } from './calendar.controller.js'

@Module({ controllers: [CalendarController] })
export class CalendarModule {}
