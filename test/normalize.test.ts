import assert from 'node:assert';
import { normalize, parseDate, parseAmount, cleanDescription, auditSignConvention } from '../src/lib/import/normalize';
import { fingerprintOf, assignSequences, filterNewRows } from '../src/lib/import/fingerprint';
import { getProfile, detectProfile, validateProfile } from '../src/lib/import/profiles';

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  pass  ${name}`);
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

const ACC = '11111111-1111-1111-1111-111111111111';

console.log('\ndate parsing');
check('parses unambiguous ISO', () => {
  assert.equal(parseDate('2026-03-04', ['YYYY-MM-DD']), '2026-03-04');
});
check('respects the declared format, not JS default', () => {
  assert.equal(parseDate('01/02/2026', ['DD/MM/YYYY']), '2026-02-01');
  assert.equal(parseDate('01/02/2026', ['MM/DD/YYYY']), '2026-01-02');
});
check('handles BMO compact dates', () => {
  assert.equal(parseDate('20260304', ['YYYYMMDD']), '2026-03-04');
});
check('handles three-letter months', () => {
  assert.equal(parseDate('04 Mar 2026', ['DD MMM YYYY']), '2026-03-04');
});
check('rejects impossible calendar dates instead of rolling over', () => {
  assert.equal(parseDate('2026-02-30', ['YYYY-MM-DD']), null);
});
check('returns null rather than guessing an unknown layout', () => {
  assert.equal(parseDate('March 4th, 2026', ['YYYY-MM-DD', 'M/D/YYYY']), null);
});

console.log('\namount parsing');
check('strips currency symbols and separators', () => {
  assert.equal(parseAmount('$1,234.56'), 1234.56);
});
check('reads accounting-style parentheses as negative', () => {
  assert.equal(parseAmount('(1,234.56)'), -1234.56);
});
check('treats blanks as absent, not zero', () => {
  assert.equal(parseAmount('   '), null);
});

console.log('\ndescription cleaning');
check('strips processor prefix and store number', () => {
  assert.equal(cleanDescription('SQ *TIM HORTONS #4471 CALGARY AB'), 'TIM HORTONS');
});
check('strips POS noise', () => {
  assert.equal(cleanDescription('POS PURCHASE SAVE ON FOODS 2201'), 'SAVE ON FOODS 2201');
});
check('leaves a clean description alone', () => {
  assert.equal(cleanDescription('SPOTIFY'), 'SPOTIFY');
});

console.log('\nTD headerless debit/credit export');
const tdProfile = getProfile('td')!;
const tdRows = [
  { col0: '03/04/2026', col1: 'SQ *TIM HORTONS #4471 CALGARY AB', col2: '4.50', col3: '', col4: '1200.00' },
  { col0: '03/04/2026', col1: 'SQ *TIM HORTONS #4471 CALGARY AB', col2: '4.50', col3: '', col4: '1195.50' },
  { col0: '03/05/2026', col1: 'PAYROLL DEPOSIT TELUS', col2: '', col3: '2400.00', col4: '3595.50' },
  { col0: 'not-a-date', col1: 'GARBAGE ROW', col2: '1.00', col3: '', col4: '' },
];
const td = normalize({ accountId: ACC, profile: tdProfile, rows: tdRows });

check('debit becomes negative, credit becomes positive', () => {
  assert.equal(td.transactions[0].amount, -4.5);
  assert.equal(td.transactions[2].amount, 2400);
});
check('bad rows are collected, not silently dropped', () => {
  assert.equal(td.errors.length, 1);
  assert.match(td.errors[0].reason, /Could not parse date/);
});
check('two identical same-day coffees survive as two rows', () => {
  assert.equal(td.transactions[0].fingerprint, td.transactions[1].fingerprint);
  assert.equal(td.transactions[0].fingerprintSeq, 0);
  assert.equal(td.transactions[1].fingerprintSeq, 1);
});
check('merchant is guessed for display', () => {
  assert.equal(td.transactions[0].merchantName, 'Tim Hortons');
});

console.log('\ncredit card inversion (Amex)');
const amex = normalize({
  accountId: ACC,
  profile: getProfile('amex_ca')!,
  rows: [
    { Date: '04 Mar 2026', Description: 'WESTJET AIRLINES', Amount: '412.30' },
    { Date: '06 Mar 2026', Description: 'PAYMENT RECEIVED THANK YOU', Amount: '-500.00' },
  ],
});
check('a card charge lands as an outflow', () => {
  assert.equal(amex.transactions[0].amount, -412.3);
});
check('a card payment lands as an inflow to the card', () => {
  assert.equal(amex.transactions[1].amount, 500);
});

console.log('\nre-import deduplication');
const first = normalize({ accountId: ACC, profile: tdProfile, rows: tdRows });
const stored = new Map<string, number>();
for (const t of first.transactions) {
  stored.set(t.fingerprint, (stored.get(t.fingerprint) ?? 0) + 1);
}
check('importing the same file again inserts nothing', () => {
  const again = normalize({ accountId: ACC, profile: tdProfile, rows: tdRows });
  const { toInsert, duplicates } = filterNewRows(again.transactions, stored);
  assert.equal(toInsert.length, 0);
  assert.equal(duplicates.length, 3);
});
check('an overlapping file with one new row inserts exactly one', () => {
  const overlap = normalize({
    accountId: ACC,
    profile: tdProfile,
    rows: [
      ...tdRows.slice(0, 3),
      { col0: '03/04/2026', col1: 'SQ *TIM HORTONS #4471 CALGARY AB', col2: '4.50', col3: '', col4: '1191.00' },
    ],
  });
  const { toInsert } = filterNewRows(overlap.transactions, stored);
  assert.equal(toInsert.length, 1);
  assert.equal(toInsert[0].fingerprintSeq, 2);
});

console.log('\nprofile detection and validation');
check('detects a known header layout', () => {
  const p = detectProfile(['Date', 'Transaction', 'Name', 'Memo', 'Amount']);
  assert.equal(p?.id, 'tangerine');
});
check('returns null rather than guessing at an unknown layout', () => {
  assert.equal(detectProfile(['Foo', 'Bar', 'Baz']), null);
});
check('a mismatched profile fails loudly with the available columns', () => {
  const problems = validateProfile(getProfile('rbc')!, ['Date', 'Description', 'Amount']);
  assert.ok(problems.length > 0);
  assert.ok(problems.some((p) => p.includes('Available columns')));
});

console.log('\nsign-convention audit');
check('flags a file where everything points the same way', () => {
  const suspicious = normalize({
    accountId: ACC,
    profile: getProfile('generic_signed')!,
    rows: Array.from({ length: 12 }, (_, i) => ({
      Date: '2026-03-04', Description: `MERCHANT ${i}`, Amount: '25.00',
    })),
  });
  assert.ok(auditSignConvention(suspicious.transactions).warning);
});
check('stays quiet on a healthy mix', () => {
  assert.equal(auditSignConvention(td.transactions).warning, null);
});

console.log(`\n${passed} checks passed\n`);
