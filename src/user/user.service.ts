import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UserResponseDto } from './dto/user-response.dto';

const SALT_ROUNDS = 10;

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  password: string;
  role: string;
  playerId: string | null;
  lastVisit: Date | null;
  createdAt: Date;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(dto: CreateUserDto): Promise<UserResponseDto> {
    if (!!dto.playerId === !!dto.newPlayer) {
      throw new BadRequestException('Provide exactly one of playerId or newPlayer');
    }

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    if (dto.newPlayer) {
      const user = await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.create({
          data: {
            name: dto.newPlayer.name,
            gender: dto.newPlayer.gender,
            active: true,
            playerStats: { create: { totalGames: 0, totalWins: 0, totalLosses: 0 } },
          },
        });

        return tx.user.create({
          data: { email: dto.email, name: dto.name, password: passwordHash, playerId: player.id },
        });
      });

      return this.toResponseDto(user);
    }

    const player = await this.prisma.player.findUnique({ where: { id: dto.playerId } });
    if (!player) {
      throw new NotFoundException(`Player with ID ${dto.playerId} not found`);
    }

    const existingLink = await this.prisma.user.findUnique({ where: { playerId: dto.playerId } });
    if (existingLink) {
      throw new ConflictException('This player is already linked to another account');
    }

    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, password: passwordHash, playerId: dto.playerId },
    });

    return this.toResponseDto(user);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateLastVisit(id: string): Promise<void> {
    await this.prisma.user.update({ where: { id }, data: { lastVisit: new Date() } });
  }

  async getCurrentUser(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toResponseDto(user);
  }

  private toResponseDto(user: UserRecord): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      playerId: user.playerId,
      createdAt: user.createdAt,
    };
  }
}
