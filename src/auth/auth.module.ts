import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AuthGuardsModule } from '../auth-guards';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [UserModule, AuthGuardsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
