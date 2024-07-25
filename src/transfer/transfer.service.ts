import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PrismaClient,
  Transaction,
  TransactionType,
  User,
} from '@prisma/client';
import { CrudService } from 'src/common/database/crud.service';
import { TransactionsMapType } from './transfer.maptype.dto';
import { WalletsService } from 'src/wallets/wallets.service';
import {
  CreateTransferDto,
  WalletTopUpDto,
  WithdrawFromWalletDto,
} from './dto/create-transfer.dto';
import { CONSTANT } from 'src/common/constants';

const { INSUFFICIENT_BALANCE } = CONSTANT;

@Injectable()
export class TransferService extends CrudService<
  Prisma.TransactionDelegate,
  TransactionsMapType
> {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly walletService: WalletsService,
  ) {
    super(prisma.transaction);
  }

  async transferFunds(dto: CreateTransferDto, senderId: string) {
    const senderWallet = await this.walletService.findWalletByUserId(senderId);

    if (senderWallet.balance < dto.amount)
      throw new BadRequestException(INSUFFICIENT_BALANCE);

    const recipientWallet = await this.walletService.findByNumber(
      dto.recipientWalletNumber,
    );

    if (!recipientWallet)
      throw new BadRequestException('Recipient Wallet Number not Found');

    return await this.prisma.$transaction(async (prisma) => {
      await prisma.wallet.update({
        where: { id: senderWallet.id },
        data: { balance: { decrement: dto.amount } },
      });

      await prisma.wallet.update({
        where: { id: recipientWallet.id },
        data: { balance: { increment: dto.amount } },
      });

      const transfer = await this.create({
        data: {
          amount: dto.amount,
          type: TransactionType.TRANSFER,
          sourceWalletId: senderWallet.id,
          destinationWalletId: recipientWallet.id,
        },
      });

      return {
        message: 'Funds Transfer Successful',
        transfer,
      };
    });
  }

  async fetchAllTransactions() {
    return this.findManyPaginate({});
  }

  async walletTopUp(dto: WalletTopUpDto, userId: string) {
    const destinationWallet = await this.walletService.findByNumber(
      dto.destinationWalletNumber,
    );

    if (!destinationWallet) {
      throw new NotFoundException('Destination wallet not found.');
    }

    if (destinationWallet.userId !== userId) {
      throw new BadRequestException('You can only top up your own wallet.');
    }
    const updatedWallet = await this.prisma.wallet.update({
      where: { id: destinationWallet.id },
      data: { balance: { increment: dto.amount } },
    });

    const transaction = await this.prisma.transaction.create({
      data: {
        amount: dto.amount,
        type: TransactionType.DEPOSIT,
        destinationWalletId: updatedWallet.id,
      },
    });

    return {
      message: 'Account Top up successsful',
      transaction,
    };
  }

  async withdrawFromWallet(
    dto: WithdrawFromWalletDto,
    userId: string,
  ): Promise<Transaction> {
    const sourceWallet = await this.walletService.findByNumber(
      dto.sourceWalletNumber,
    );

    if (!sourceWallet) {
      throw new NotFoundException('Wallet not found.');
    }

    if (sourceWallet.userId !== userId) {
      throw new ForbiddenException('You are allowed to perform this action');
    }

    if (sourceWallet.balance < dto.amount) {
      throw new BadRequestException(
        'Insufficient balance for this transaction.',
      );
    }

    const updatedWallet = await this.prisma.wallet.update({
      where: { id: sourceWallet.id },
      data: { balance: { decrement: dto.amount } },
    });

    const transaction = (await this.create({
      data: {
        amount: dto.amount,
        type: TransactionType.WITHDRAWAL,
        sourceWalletId: updatedWallet.id,
      },
    })) as Transaction;

    return transaction;
  }
}