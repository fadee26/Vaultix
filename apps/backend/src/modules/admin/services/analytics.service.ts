import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThan } from 'typeorm';
import { Escrow, EscrowStatus } from '../../escrow/entities/escrow.entity';
import { Dispute, DisputeStatus } from '../../escrow/entities/dispute.entity';
import { User } from '../../user/entities/user.entity';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private cache = new Map<string, { data: any; expiry: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(Escrow)
    private escrowRepository: Repository<Escrow>,
    @InjectRepository(Dispute)
    private disputeRepository: Repository<Dispute>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  private getFromCache(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + this.CACHE_TTL,
    });
  }

  async getOverview() {
    const cacheKey = 'analytics_overview';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);

    const [
      escrowsByStatus,
      totalVolumeRaw,
      activeUsersCount,
      newUsersCount,
    ] = await Promise.all([
      this.escrowRepository
        .createQueryBuilder('escrow')
        .select('escrow.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('escrow.status')
        .getRawMany(),
      this.escrowRepository
        .createQueryBuilder('escrow')
        .select('SUM(escrow.amount)', 'total')
        .where('escrow.status = :status', { status: EscrowStatus.COMPLETED })
        .getRawOne(),
      this.userRepository.count({
        where: { updatedAt: MoreThan(last30Days) },
      }),
      this.userRepository.count({
        where: { createdAt: MoreThan(last30Days) },
      }),
    ]);

    const totalVolume = parseFloat(totalVolumeRaw?.total || '0');
    const platformFees = totalVolume * 0.01; // Assuming 1% platform fee

    const stats = {
      escrows: escrowsByStatus.reduce((acc, curr) => {
        acc[curr.status] = parseInt(curr.count);
        return acc;
      }, {}),
      volume: {
        totalCompleted: totalVolume,
        platformFeesCollected: platformFees,
      },
      users: {
        activeLast30Days: activeUsersCount,
        newLast30Days: newUsersCount,
      },
    };

    this.setCache(cacheKey, stats);
    return stats;
  }

  async getVolumeStats(period: 'daily' | 'weekly' | 'monthly', from?: string, to?: string) {
    const cacheKey = `analytics_volume_${period}_${from}_${to}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    let dateFormat: string;
    switch (period) {
      case 'daily':
        dateFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        dateFormat = '%Y-%W';
        break;
      case 'monthly':
        dateFormat = '%Y-%m';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }

    const query = this.escrowRepository
      .createQueryBuilder('escrow')
      .select(`strftime('${dateFormat}', escrow.createdAt)`, 'bucket')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(escrow.amount)', 'volume')
      .groupBy('bucket')
      .orderBy('bucket', 'ASC');

    if (from && to) {
      query.where('escrow.createdAt BETWEEN :from AND :to', { from, to });
    }

    const results = await query.getRawMany();

    const stats = results.map(r => ({
      period: r.bucket,
      count: parseInt(r.count),
      volume: parseFloat(r.volume || '0'),
    }));

    this.setCache(cacheKey, stats);
    return stats;
  }

  async getDisputeMetrics() {
    const cacheKey = 'analytics_disputes';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const [
      totalEscrows,
      totalDisputes,
      outcomes,
      avgResolutionRaw,
    ] = await Promise.all([
      this.escrowRepository.count(),
      this.disputeRepository.count(),
      this.disputeRepository
        .createQueryBuilder('dispute')
        .select('dispute.outcome', 'outcome')
        .addSelect('COUNT(*)', 'count')
        .where('dispute.status = :status', { status: DisputeStatus.RESOLVED })
        .groupBy('dispute.outcome')
        .getRawMany(),
      this.disputeRepository
        .createQueryBuilder('dispute')
        .select('AVG(julianday(dispute.resolvedAt) - julianday(dispute.createdAt))', 'avgDays')
        .where('dispute.status = :status', { status: DisputeStatus.RESOLVED })
        .getRawOne(),
    ]);

    const disputeRate = totalEscrows > 0 ? (totalDisputes / totalEscrows) * 100 : 0;

    const stats = {
      totalDisputes,
      disputeRate: parseFloat(disputeRate.toFixed(2)),
      avgResolutionTimeDays: parseFloat(parseFloat(avgResolutionRaw?.avgDays || '0').toFixed(2)),
      outcomeDistribution: outcomes.reduce((acc, curr) => {
        if (curr.outcome) {
          acc[curr.outcome] = parseInt(curr.count);
        }
        return acc;
      }, {}),
    };

    this.setCache(cacheKey, stats);
    return stats;
  }

  async getTopUsers(limit: number = 10) {
    const cacheKey = `analytics_top_users_${limit}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Use QueryBuilder to join Escrow and Party to find top users by volume
    const topUsers = await this.userRepository
      .createQueryBuilder('user')
      .leftJoin('escrow_parties', 'party', 'party.userId = user.id')
      .leftJoin('escrows', 'escrow', 'escrow.id = party.escrowId')
      .select('user.walletAddress', 'walletAddress')
      .addSelect('COUNT(DISTINCT escrow.id)', 'escrowCount')
      .addSelect('SUM(escrow.amount)', 'totalVolume')
      .addSelect(
        'SUM(CASE WHEN escrow.status = :completed THEN 1 ELSE 0 END) * 1.0 / COUNT(escrow.id)',
        'completionRate'
      )
      .setParameter('completed', EscrowStatus.COMPLETED)
      .groupBy('user.id')
      .orderBy('totalVolume', 'DESC')
      .limit(limit)
      .getRawMany();

    const stats = topUsers.map(u => ({
      walletAddress: u.walletAddress,
      escrowCount: parseInt(u.escrowCount),
      totalVolume: parseFloat(u.totalVolume || '0'),
      completionRate: parseFloat(parseFloat(u.completionRate || '0').toFixed(2)),
    }));

    this.setCache(cacheKey, stats);
    return stats;
  }
}
