import { Injectable } from '@nestjs/common';

@Injectable()
export class TrainingService {
  createTraining(): string {
    return 'create some training';
  }
  getTraining(): string {
    return 'get some training';
  }
  updateTraining(): string {
    return 'upd some training';
  }
  deleteTraining(): string {
    return 'delete some training';
  }
}
