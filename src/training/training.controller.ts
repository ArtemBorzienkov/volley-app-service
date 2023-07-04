import { Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { TrainingService } from './training.service';

@Controller('/training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post()
  createTraining(@Req() req: Request) {
    return this.trainingService.createTraining(req.body);
  }
}
