import { ALL_RULE_KEYS, isRuleKey, ruleKeysForScheme } from './rules';

describe('rule catalogue', () => {
  it('offers a scheme its own steps followed by the general rules', () => {
    expect(ruleKeysForScheme('roundRobin')).toEqual([
      'roundRobin.step1',
      'roundRobin.step2',
      'roundRobin.step3',
      'serving',
      'tiebreak',
    ]);
  });

  it('gives fullRotation its five steps', () => {
    expect(ruleKeysForScheme('fullRotation')).toEqual([
      'fullRotation.step1',
      'fullRotation.step2',
      'fullRotation.step3',
      'fullRotation.step4',
      'fullRotation.step5',
      'serving',
      'tiebreak',
    ]);
  });

  // An unknown scheme is what a config row written by an older or newer version can hold; the Rules
  // tab falls back the same way, so both sides show round robin rather than nothing.
  it('falls back to roundRobin for an unknown scheme', () => {
    expect(ruleKeysForScheme('mystery')).toEqual(ruleKeysForScheme('roundRobin'));
  });

  it('accepts every key any scheme can show, and nothing else', () => {
    for (const key of ALL_RULE_KEYS) expect(isRuleKey(key)).toBe(true);

    expect(isRuleKey('roundRobin.step9')).toBe(false);
    expect(isRuleKey('serving ')).toBe(false);
    expect(isRuleKey(42)).toBe(false);
    expect(isRuleKey(null)).toBe(false);
  });

  it('has no duplicate keys, so a hidden key can only mean one rule', () => {
    expect(new Set(ALL_RULE_KEYS).size).toBe(ALL_RULE_KEYS.length);
  });
});
