import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { UsersController } from './users.controller';
import { GoogleIdentityVerifier } from './google-identity-verifier';

const ISSUER = 'indoor-cricket-booking';
const AUDIENCE = 'booking-api';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
          throw new Error('JWT_SECRET must be at least 32 UTF-8 bytes');
        }

        return {
          secret,
          signOptions: { algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE },
          verifyOptions: { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE },
        };
      },
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    GoogleIdentityVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
