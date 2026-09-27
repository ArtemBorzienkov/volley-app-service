/**
 * The rules a tournament's Rules tab can show, as stable keys. The UI holds the wording in its four
 * locale files; this side only decides which keys are real, so `hiddenRules` can never accumulate
 * junk that no longer maps to anything.
 *
 * Keys are namespaced by scheme where the rule describes the format itself, and bare where the rule
 * is a house rule that holds whatever the format is.
 */

/** Rules that apply to every scheme. */
export const GENERAL_RULE_KEYS = ['serving', 'tiebreak'] as const;

/** Per-scheme steps, in the order the day actually runs. */
export const SCHEME_RULE_KEYS: Record<string, readonly string[]> = {
  roundRobin: ['roundRobin.step1', 'roundRobin.step2', 'roundRobin.step3'],
  groupsPlayoff: ['groupsPlayoff.step1', 'groupsPlayoff.step2', 'groupsPlayoff.step3', 'groupsPlayoff.step4'],
  fullRotation: [
    'fullRotation.step1',
    'fullRotation.step2',
    'fullRotation.step3',
    'fullRotation.step4',
    'fullRotation.step5',
  ],
};

/** Every key any scheme could use — what `hiddenRules` is validated against. */
export const ALL_RULE_KEYS: readonly string[] = [...Object.values(SCHEME_RULE_KEYS).flat(), ...GENERAL_RULE_KEYS];

export function isRuleKey(value: unknown): value is string {
  return typeof value === 'string' && ALL_RULE_KEYS.includes(value);
}

/**
 * The rules one scheme can show. Hidden keys belonging to another scheme are kept in storage rather
 * than filtered out here: switching scheme back must restore what the organiser chose before.
 */
export function ruleKeysForScheme(scheme: string): readonly string[] {
  return [...(SCHEME_RULE_KEYS[scheme] ?? SCHEME_RULE_KEYS.roundRobin), ...GENERAL_RULE_KEYS];
}
