import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { User } from 'src/utils/types';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async createUser(data: User): Promise<User> {
    try {
      console.log(`[USER] Creating new user: ${data.firstName}`);
      let user = await this.getUserById(data.id);
      if (!user) {
        user = await this.prisma.user.create({ data });
      }
      return user;
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }

  async getUserById(id: string): Promise<User> {
    try {
      console.log(`[USER] Fetch user by id: ${id}`);
      const user = await this.prisma.user.findUnique({ where: { id } });
      return user;
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }

  async updateUser(data: User): Promise<User> {
    try {
      console.log(`[USER] Update user: ${data.firstName}`);
      const user = await this.prisma.user.update({
        where: { id: data.id },
        data,
      });
      return user;
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }

  async deleteUser(id: string) {
    try {
      console.log(`[USER] Delete user by id: ${id}`);
      await this.prisma.user.delete({
        where: { id },
      });
    } catch (e) {
      console.error(e);
      throw new ForbiddenException('cannot create training');
    }
  }
}
