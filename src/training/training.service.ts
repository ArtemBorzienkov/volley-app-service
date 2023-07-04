import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Training } from 'src/utils/types';

@Injectable()
export class TrainingService {
  constructor(private prisma: PrismaService) {}

  async createTraining(data: Training) {
    try {
      console.log(
        `[TRAINING] Creating new training by config: ${data.configId}`,
      );
      const training = await this.prisma.training.create({ data });
      return training || {};
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }
}
