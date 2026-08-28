import { Injectable } from '@nestjs/common';
import { User, UserRole } from '@local-delivery/types';
import { ForbiddenError } from './domain-errors';
import { InMemoryStore } from './in-memory-store';
import { PrismaService } from './prisma.service';

@Injectable()
export class ActorService {
  constructor(
    private readonly store: InMemoryStore,
    private readonly prisma: PrismaService,
  ) {}

  async requireActor(userId: string): Promise<User> {
    if (!userId) throw new ForbiddenError('Missing or invalid x-user-id');

    if (!this.prisma.isEnabled()) {
      const actor = this.store.getUser(userId);
      if (!actor) throw new ForbiddenError('Missing or invalid x-user-id');
      return actor;
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: true } } },
    });
    if (!actor) throw new ForbiddenError('Missing or invalid x-user-id');

    return {
      id: actor.id,
      phone: actor.phone,
      email: actor.email ?? undefined,
      name: actor.name ?? undefined,
      status: actor.status as User['status'],
      roles: actor.userRoles.map((userRole) => userRole.role.code as UserRole),
      createdAt: actor.createdAt.toISOString(),
    };
  }
}
