import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { frontendCors } from '../http-options';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({ namespace: '/availability', cors: frontendCors() })
export class AvailabilityGateway implements OnGatewayInit<Namespace> {
  @WebSocketServer()
  private namespace?: Namespace;

  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      const token: unknown = socket.handshake.auth.token;
      if (token === undefined) {
        const tenantSlug: unknown = socket.handshake.auth.tenantSlug;
        if (typeof tenantSlug !== 'string' || tenantSlug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug)) return next(new Error('Unauthorized'));
        void this.prisma.tenant.findUnique({ where: { slug: tenantSlug }, select: { id: true, branches: { where: { isActive: true }, take: 1, select: { id: true } } } }).then((tenant) => {
          if (!tenant?.branches.length) return next(new Error('Arena not found'));
          socket.data.tenantId = tenant.id;
          socket.data.publicAvailability = true;
          socket.data.expiresAt = Date.now() + 60 * 60_000;
          next();
        }).catch(() => next(new Error('Unauthorized')));
        return;
      }
      if (typeof token !== 'string') {
        return next(new Error('Unauthorized'));
      }

      void this.auth.verifyAccessToken(token).then((principal) => {
        socket.data.tenantId = principal.tenantId;
        socket.data.expiresAt = principal.expiresAt;
        next();
      }).catch(() => next(new Error('Unauthorized')));
    });

    namespace.on('connection', (socket) => {
      const tenantId: string = socket.data.tenantId;
      const expiresAt: number = socket.data.expiresAt;
      const disconnect = setTimeout(() => socket.disconnect(true), Math.max(0, expiresAt - Date.now()));
      socket.once('disconnect', () => clearTimeout(disconnect));
      void socket.join(socket.data.publicAvailability ? 'public:' + tenantId : tenantId);
    });
  }

  changed(tenantId: string): void {
    this.namespace?.to(tenantId).emit('availability.changed');
    // Public subscribers receive only this empty invalidation signal.
    this.namespace?.to('public:' + tenantId).emit('availability.changed');
  }
}
