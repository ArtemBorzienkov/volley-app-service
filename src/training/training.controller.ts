import { Controller, Delete, Get, Post, Put } from '@nestjs/common';
import { TrainingService } from './Training.service';

@Controller('/training')
export class TrainingController {
  constructor(private readonly trainingService: TrainingService) {}

  @Post()
  createTraining(): string {
    return this.trainingService.createTraining();
  }

  @Get()
  getTraining(): string {
    return this.trainingService.getTraining();
  }

  @Put()
  updateTraining(): string {
    return this.trainingService.updateTraining();
  }

  @Delete()
  deleteTraining(): string {
    return this.trainingService.deleteTraining();
  }
}
