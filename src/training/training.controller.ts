import { Controller, Post, Req, Get, Query, Put } from '@nestjs/common';
import { Request } from 'express';
import { TrainingService } from './training.service';

@Controller('/training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post()
  createTraining(@Req() req: Request) {
    return this.trainingService.createTraining(req.body);
  }

  @Get()
  getTraining(@Query() query: { id: string }) {
    return this.trainingService.getTraining(query.id);
  }

  @Put()
  updateTraining(@Req() req: Request) {
    return this.trainingService.updateTraining(req.body);
  }
}
