import { OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Namespace } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { frontendCors } from '../http-options';

@WebSocketGateway({ namespace: '/availability', cors: frontendCors() })
export class AvailabilityGateway implements OnGatewayInit<Namespace> {
  @WebSocketServer()
  private namespace?: Namespace;

  constructor(private readonly auth: AuthService) {}

  afterInit(namespace: Namespace): void {
    namespace.use((socket, next) => {
      const token: unknown = socket.handshake.auth.token;
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
      void socket.join(tenantId);
    });
  }

  changed(tenantId: string): void {
    this.namespace?.to(tenantId).emit('availability.changed');
  }
}
