import Decimal from 'decimal.js';
import { IExpense, ExpenseStatus } from '../models/Expense';
import { ISettlement } from '../models/Settlement';

export interface BalanceMap {
  [userOwes: number]: {
    [userOwedTo: number]: string; // decimal string
  };
}

export class LedgerService {
  /**
   * Calculates net balances for all members in a group.
   * Format: balances[userA][userB] means userA owes userB that amount.
   */
  static calculateBalances(expenses: IExpense[], settlements: ISettlement[]): BalanceMap {
    const balances: { [userA: number]: { [userB: number]: Decimal } } = {};

    const addDebt = (debtor: number, creditor: number, amount: Decimal) => {
      if (debtor === creditor) return; // You don't owe yourself
      if (!balances[debtor]) balances[debtor] = {};
      if (!balances[creditor]) balances[creditor] = {};

      if (!balances[debtor][creditor]) balances[debtor][creditor] = new Decimal(0);
      if (!balances[creditor][debtor]) balances[creditor][debtor] = new Decimal(0);

      // Add to what debtor owes creditor
      balances[debtor][creditor] = balances[debtor][creditor].plus(amount);
      // Effectively reduces what creditor owes debtor
      balances[creditor][debtor] = balances[creditor][debtor].minus(amount);
    };

    // 1. Process Expenses
    for (const expense of expenses) {
      if (expense.status !== ExpenseStatus.CONFIRMED) continue;

      const creditorId = expense.paidByTelegramUserId;

      // Shared
      for (const participant of expense.sharedParticipants) {
        const debtorId = participant.telegramUserId;
        const shareAmount = new Decimal(participant.share);
        addDebt(debtorId, creditorId, shareAmount);
      }

      // Personal
      for (const participant of expense.personalExpenses) {
        const debtorId = participant.telegramUserId;
        const amount = new Decimal(participant.share);
        addDebt(debtorId, creditorId, amount);
      }
    }

    // 2. Process Settlements (Payments)
    for (const settlement of settlements) {
      if (settlement.status !== 'CONFIRMED') continue;
      
      // Settlement: paidBy A, paidTo B. Meaning A paid B.
      // This is equivalent to B owing A the amount, which nets against A owing B.
      const debtorId = settlement.paidToTelegramUserId; 
      const creditorId = settlement.paidByTelegramUserId;
      const amount = new Decimal(settlement.amount);
      addDebt(debtorId, creditorId, amount);
    }

    // 3. Simplify & Format Output
    const result: BalanceMap = {};
    for (const debtorStr in balances) {
      const debtor = parseInt(debtorStr, 10);
      for (const creditorStr in balances[debtor]) {
        const creditor = parseInt(creditorStr, 10);
        const amount = balances[debtor]?.[creditor];
        if (amount && amount.isPositive() && !amount.isZero()) { // Only record positive debts
          if (!result[debtor]) result[debtor] = {};
          result[debtor][creditor] = amount.toFixed(2);
        }
      }
    }

    return result;
  }
}
