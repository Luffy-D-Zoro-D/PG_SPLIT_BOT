import Decimal from 'decimal.js';
import { IExpense, ExpenseStatus } from '../models/Expense';
import { ISettlement } from '../models/Settlement';

export interface BalanceMap {
  [userOwes: number]: {
    [userOwedTo: number]: string; // decimal string
  };
}

export interface LedgerBalances {
  net: BalanceMap;
  gross: BalanceMap;
}

export class LedgerService {
  /**
   * Calculates net and gross balances for all members in a group.
   * Format: balances[userA][userB] means userA owes userB that amount.
   */
  static calculateBalances(expenses: IExpense[], settlements: ISettlement[]): LedgerBalances {
    const netBalances: { [userA: number]: { [userB: number]: Decimal } } = {};
    const grossBalances: { [userA: number]: { [userB: number]: Decimal } } = {};

    const addNetDebt = (debtor: number, creditor: number, amount: Decimal) => {
      if (debtor === creditor) return;
      if (!netBalances[debtor]) netBalances[debtor] = {};
      if (!netBalances[creditor]) netBalances[creditor] = {};
      if (!netBalances[debtor][creditor]) netBalances[debtor][creditor] = new Decimal(0);
      if (!netBalances[creditor][debtor]) netBalances[creditor][debtor] = new Decimal(0);
      netBalances[debtor][creditor] = netBalances[debtor][creditor].plus(amount);
      netBalances[creditor][debtor] = netBalances[creditor][debtor].minus(amount);
    };

    const addGrossDebt = (debtor: number, creditor: number, amount: Decimal) => {
      if (debtor === creditor) return;
      if (!grossBalances[debtor]) grossBalances[debtor] = {};
      if (!grossBalances[debtor][creditor]) grossBalances[debtor][creditor] = new Decimal(0);
      grossBalances[debtor][creditor] = grossBalances[debtor][creditor].plus(amount);
    };

    // 1. Process Expenses
    for (const expense of expenses) {
      if (expense.status !== ExpenseStatus.CONFIRMED) continue;
      const creditorId = expense.paidByTelegramUserId;

      // Shared
      for (const participant of expense.sharedParticipants) {
        const debtorId = participant.telegramUserId;
        const shareAmount = new Decimal(participant.share);
        addNetDebt(debtorId, creditorId, shareAmount);
        addGrossDebt(debtorId, creditorId, shareAmount);
      }

      // Personal
      for (const participant of expense.personalExpenses) {
        const debtorId = participant.telegramUserId;
        const amount = new Decimal(participant.share);
        addNetDebt(debtorId, creditorId, amount);
        addGrossDebt(debtorId, creditorId, amount);
      }
    }

    // 2. Process Settlements (Payments)
    for (const settlement of settlements) {
      if (settlement.status !== 'CONFIRMED') continue;
      // Settlement: paidBy A, paidTo B => A pays B.
      // Net: B owes A the amount.
      const debtorId = settlement.paidToTelegramUserId; 
      const creditorId = settlement.paidByTelegramUserId;
      const amount = new Decimal(settlement.amount);
      addNetDebt(debtorId, creditorId, amount);
      
      // Gross: Since A pays B, A's gross debt to B is reduced. 
      // If A's debt to B goes negative, it does NOT create a debt from B to A in gross terms 
      // (gross is strictly "spent for each other"), but for simplicity, we subtract it.
      if (grossBalances[creditorId] && grossBalances[creditorId][debtorId]) {
        grossBalances[creditorId][debtorId] = grossBalances[creditorId][debtorId].minus(amount);
        if (grossBalances[creditorId][debtorId].isNegative()) {
          grossBalances[creditorId][debtorId] = new Decimal(0);
        }
      }
    }

    // 3. Simplify & Format Output
    const result: LedgerBalances = { net: {}, gross: {} };
    for (const debtorStr in netBalances) {
      const debtor = parseInt(debtorStr, 10);
      for (const creditorStr in netBalances[debtor]) {
        const creditor = parseInt(creditorStr, 10);
        const amount = netBalances[debtor]?.[creditor];
        if (amount && amount.isPositive() && !amount.isZero()) {
          if (!result.net[debtor]) result.net[debtor] = {};
          result.net[debtor][creditor] = amount.toFixed(2);
        }
      }
    }

    for (const debtorStr in grossBalances) {
      const debtor = parseInt(debtorStr, 10);
      for (const creditorStr in grossBalances[debtor]) {
        const creditor = parseInt(creditorStr, 10);
        const amount = grossBalances[debtor]?.[creditor];
        if (amount && amount.isPositive() && !amount.isZero()) {
          if (!result.gross[debtor]) result.gross[debtor] = {};
          result.gross[debtor][creditor] = amount.toFixed(2);
        }
      }
    }

    return result;
  }
}
