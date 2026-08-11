import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { LedgerService } from './services/LedgerService';
import Expense from './models/Expense';
import Settlement from './models/Settlement';
import { ExpenseService } from './services/ExpenseService';

dotenv.config();

async function runTests() {
  console.log('Connecting to DB...');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/expensebot');
  console.log('DB Connected.\n');

  let passed = 0;
  let failed = 0;

  function assertEqual(testName: string, actual: any, expected: any) {
    if (actual === expected) {
      console.log(`✅ ${testName}: PASS`);
      passed++;
    } else {
      console.error(`❌ ${testName}: FAIL (Expected: ${expected}, Actual: ${actual})`);
      failed++;
    }
  }

  // --- Test 1: Pending Settlements do not affect ledger ---
  try {
    const mockExpenses: any[] = [
      {
        totalAmount: '500',
        paidByTelegramUserId: 1,
        sharedParticipants: [{ telegramUserId: 1, share: '250' }, { telegramUserId: 2, share: '250' }],
        personalExpenses: [],
        status: 'CONFIRMED'
      }
    ];

    const mockSettlements: any[] = [
      {
        amount: '300',
        paidByTelegramUserId: 2,
        paidToTelegramUserId: 1,
        status: 'PENDING_APPROVAL'
      }
    ];

    const balances1 = LedgerService.calculateBalances(mockExpenses, mockSettlements);
    assertEqual('PENDING_APPROVAL settlement does NOT affect ledger', balances1.net['2']['1'], '250.00');

    mockSettlements[0].status = 'CONFIRMED';
    const balances2 = LedgerService.calculateBalances(mockExpenses, mockSettlements);
    // 2 owed 1 250. 2 paid 1 300. So 1 owes 2 50.
    assertEqual('CONFIRMED settlement affects ledger', balances2.net['1']['2'], '50.00');
  } catch (e: any) {
    console.error(e);
    failed++;
  }

  // --- Test 2: Identity Resolution Ambiguity ---
  try {
    const memberMap = new Map();
    memberMap.set('alex smith', 1);
    memberMap.set('alex johnson', 2);
    memberMap.set('sam', 3);

    // Testing the private method via hack since it's private
    const findMatchingUser = (ExpenseService as any).findMatchingUser;
    
    const ambiguousMatch = findMatchingUser('Alex', memberMap);
    assertEqual('Ambiguous user match returns null', ambiguousMatch, null);

    const exactMatch = findMatchingUser('sam', memberMap);
    assertEqual('Exact user match returns ID', exactMatch, 3);
  } catch (e: any) {
    console.error(e);
    failed++;
  }

  console.log(`\nTests finished. ${passed} Passed, ${failed} Failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

runTests();
