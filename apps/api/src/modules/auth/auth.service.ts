import { Injectable } from '@nestjs/common';
import { InMemoryStore } from '../../common/in-memory-store';
import { ForbiddenError } from '../../common/domain-errors';
import { User, UserRole } from '@local-delivery/types';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class AuthService {
  private readonly otpChallenges = new Map<string, { code: string; expiresAt: number; attempts: number }>();

  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  async requestOtp(phone: string) {
    const code = process.env.OTP_DEV_CODE ?? '123456';
    if (this.prisma.isEnabled()) {
      await this.prisma.otpChallenge.create({
        data: {
          phone,
          codeHash: code,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    } else {
      this.otpChallenges.set(phone, {
        code,
        expiresAt: Date.now() + 5 * 60 * 1000,
        attempts: 0,
      });
    }

    return {
      phone,
      expiresInSeconds: 300,
      devCode: code,
    };
  }

  async verifyOtp(phone: string, code: string, roleHint: UserRole = 'CUSTOMER') {
    if (this.prisma.isEnabled()) {
      return this.verifyOtpWithPrisma(phone, code, roleHint);
    }

    const challenge = this.otpChallenges.get(phone);
    if (!challenge || challenge.expiresAt < Date.now()) {
      throw new ForbiddenError('OTP is invalid or expired');
    }
    if (challenge.attempts >= 5) {
      throw new ForbiddenError('Too many OTP attempts');
    }
    challenge.attempts += 1;
    if (challenge.code !== code) {
      throw new ForbiddenError('OTP is invalid or expired');
    }

    this.otpChallenges.delete(phone);
    const roles: UserRole[] = roleHint === 'OPS_ADMIN' ? ['OPS_ADMIN'] : [roleHint];
    const user = this.store.findOrCreateUser(phone, roles);

    return {
      accessToken: user.id,
      tokenType: 'dev-user-id',
      user,
    };
  }

  async me(userId: string) {
    if (this.prisma.isEnabled()) {
      return this.requirePrismaUser(userId);
    }

    const user = this.store.getUser(userId);
    if (!user) {
      throw new ForbiddenError('Invalid session');
    }
    return user;
  }

  private async verifyOtpWithPrisma(phone: string, code: string, roleHint: UserRole) {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phone,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new ForbiddenError('OTP is invalid or expired');
    if (challenge.attempts >= 5) throw new ForbiddenError('Too many OTP attempts');

    await this.prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    if (challenge.codeHash !== code) throw new ForbiddenError('OTP is invalid or expired');

    const roles: UserRole[] = roleHint === 'OPS_ADMIN' ? ['OPS_ADMIN'] : [roleHint];
    const user = await this.prisma.$transaction(async (tx) => {
      const currentUser = await tx.user.upsert({
        where: { phone },
        update: {},
        create: { phone, status: 'ACTIVE' },
      });

      for (const code of roles) {
        const role = await tx.role.upsert({
          where: { code },
          update: {},
          create: { code },
        });
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: currentUser.id, roleId: role.id } },
          update: {},
          create: { userId: currentUser.id, roleId: role.id },
        });
      }

      if (roles.includes('RIDER')) {
        await tx.riderProfile.upsert({
          where: { userId: currentUser.id },
          update: {},
          create: {
            userId: currentUser.id,
            approvalStatus: 'APPROVED',
            availabilityStatus: 'OFFLINE',
            vehicleType: 'BIKE',
            activeJobLimit: 1,
            suspended: false,
          },
        });
      }

      await tx.otpChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          actorId: currentUser.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: currentUser.id,
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: currentUser.id },
        include: { userRoles: { include: { role: true } } },
      });
    });

    return {
      accessToken: user.id,
      tokenType: 'dev-user-id',
      user: this.toUser(user),
    };
  }

  private async requirePrismaUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) throw new ForbiddenError('Invalid session');
    return this.toUser(user);
  }

  private toUser(user: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
    status: string;
    createdAt: Date;
    userRoles: { role: { code: string } }[];
  }): User {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      status: user.status as User['status'],
      roles: user.userRoles.map((userRole) => userRole.role.code as UserRole),
      createdAt: user.createdAt.toISOString(),
    };
  }
}
