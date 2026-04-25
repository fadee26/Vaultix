import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
  },
  namespace: 'escrow',
})
export class EscrowGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EscrowGateway.name);
  private userSocketMap: Map<string, string[]> = new Map(); // userId -> socketIds[]
  private socketUserMap: Map<string, string> = new Map(); // socketId -> userId
  private socketEscrowMap: Map<string, string[]> = new Map(); // socketId -> escrowIds[]

  constructor(private jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Connection rejected: No token provided (${client.id})`);
        client.disconnect();
        return;
      }

      // Verify JWT
      const decoded = this.jwtService.verify(token);
      const userId = decoded.sub || decoded.userId;

      if (!userId) {
        this.logger.warn(`Connection rejected: Invalid token (${client.id})`);
        client.disconnect();
        return;
      }

      // Store connection mapping
      this.socketUserMap.set(client.id, userId);
      const userSockets = this.userSocketMap.get(userId) || [];
      userSockets.push(client.id);
      this.userSocketMap.set(userId, userSockets);

      this.logger.log(`Client connected: ${client.id} (user: ${userId})`);

      // Send connection success
      client.emit('connected', { userId, socketId: client.id });
    } catch (error) {
      this.logger.error(`Connection rejected: Invalid token (${client.id})`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketUserMap.get(client.id);
    if (userId) {
      // Remove from user mapping
      const userSockets = this.userSocketMap.get(userId) || [];
      const updatedSockets = userSockets.filter((id) => id !== client.id);
      if (updatedSockets.length === 0) {
        this.userSocketMap.delete(userId);
      } else {
        this.userSocketMap.set(userId, updatedSockets);
      }
      this.socketUserMap.delete(client.id);

      // Clean up escroom subscriptions
      const escrowIds = this.socketEscrowMap.get(client.id) || [];
      escrowIds.forEach((escrowId) => {
        client.leave(`escrow:${escrowId}`);
      });
      this.socketEscrowMap.delete(client.id);

      this.logger.log(`Client disconnected: ${client.id} (user: ${userId})`);
    }
  }

  @SubscribeMessage('joinEscrow')
  handleJoinEscrow(client: Socket, escrowId: string) {
    const room = `escrow:${escrowId}`;
    client.join(room);

    // Track subscription
    const escrowIds = this.socketEscrowMap.get(client.id) || [];
    if (!escrowIds.includes(escrowId)) {
      escrowIds.push(escrowId);
      this.socketEscrowMap.set(client.id, escrowIds);
    }

    this.logger.log(`Client ${client.id} joined escrow room: ${escrowId}`);
    client.emit('joinedEscrow', { escrowId });
  }

  @SubscribeMessage('leaveEscrow')
  handleLeaveEscrow(client: Socket, escrowId: string) {
    const room = `escrow:${escrowId}`;
    client.leave(room);

    // Remove from tracking
    const escrowIds = this.socketEscrowMap.get(client.id) || [];
    const updatedEscrowIds = escrowIds.filter((id) => id !== escrowId);
    this.socketEscrowMap.set(client.id, updatedEscrowIds);

    this.logger.log(`Client ${client.id} left escrow room: ${escrowId}`);
  }

  // Broadcast methods - called from EscrowService
  broadcastEscrowStatusChanged(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:status_changed', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastMilestoneReleased(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:milestone_released', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastDisputeFiled(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:dispute_filed', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastDisputeResolved(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:dispute_resolved', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastPartyJoined(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:party_joined', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastConditionFulfilled(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:condition_fulfilled', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastConditionConfirmed(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:condition_confirmed', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastNotification(userId: string, data: any) {
    const socketIds = this.userSocketMap.get(userId) || [];
    socketIds.forEach((socketId) => {
      this.server.to(socketId).emit('notification:new', {
        ...data,
        timestamp: new Date().toISOString(),
      });
    });
  }

  broadcastEscrowFunded(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:funded', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastEscrowCompleted(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:completed', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastEscrowCancelled(escrowId: string, data: any) {
    this.server.to(`escrow:${escrowId}`).emit('escrow:cancelled', {
      escrowId,
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  // Get online users (for admin/monitoring)
  getOnlineUsers(): Map<string, string[]> {
    return this.userSocketMap;
  }

  // Get user's socket IDs
  getUserSockets(userId: string): string[] {
    return this.userSocketMap.get(userId) || [];
  }

  // Check if user is online
  isUserOnline(userId: string): boolean {
    const sockets = this.userSocketMap.get(userId) || [];
    return sockets.length > 0;
  }
}
