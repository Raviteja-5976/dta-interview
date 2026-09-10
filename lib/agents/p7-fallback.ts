/**
 * Built-in challenges, for when generation fails.
 *
 * A module the candidate paid for must be asked. P7 and SC are the slowest and
 * most failure-prone calls in preparation — deep tier, long structured output,
 * and for P7 a high reasoning budget that can run past its deadline — and when
 * every slot of a module failed, the whole round used to be dropped from the
 * interview. Now a failed slot is filled from here instead.
 *
 * ── Coding: hand-written, with verified tests ───────────────────────────────
 * The one property a coding fallback cannot lack is a correct expected value on
 * every test — a wrong one fails a candidate whose code was right, the worst
 * defect this system can ship (see CODING_SYSTEM). So these are fixed problems,
 * not templates, and every test was checked against the reference solution.
 * They are written in the same signature format as generated problems, so the
 * harness gives them starter code in every language.
 *
 * ── Skill: templated on the skill the slot was for ──────────────────────────
 * A query task for a query language, a written design walk-through for
 * anything else — so the round is still about the technology the job needs,
 * even when the model was not there to write it.
 */

import { finaliseCodingChallenge } from '../execution/harness';
import type { CodingChallenge, CodingChallengeDraft, SkillChallenge } from './schemas';
import type { ChallengeInput, SkillTarget } from './p7-challenge';

// ── Coding bank ──────────────────────────────────────────────────────────────

const VALID_PARENTHESES: CodingChallengeDraft = {
  v: 3,
  title: 'Valid Parentheses',
  topic: 'stack',
  level: 'easy',
  problem_statement:
    'Given a string s containing only the characters (, ), {, }, [ and ], determine whether it is valid. It is valid when every opening bracket is closed by a bracket of the same type, and brackets are closed in the correct order.',
  constraints: ['1 <= s.length <= 10^4', 's consists only of the characters ()[]{}'],
  input_format: 's — a string of brackets.',
  output_format: 'true if s is valid, otherwise false.',
  signature: { function_name: 'isValid', params: [{ name: 's', type: 'string' }], return_type: 'bool' },
  examples: [
    { input: 's = "()[]{}"', output: 'true', explanation: 'Each bracket is closed by its own type, in order.' },
    { input: 's = "(]"', output: 'false', explanation: 'The ( is closed by a ], which is the wrong type.' },
    { input: 's = "{[]}"', output: 'true', explanation: 'The inner [] closes before the outer {}.' },
  ],
  visible_tests: [
    { input: '"()"', expected: 'true' },
    { input: '"()[]{}"', expected: 'true' },
    { input: '"(]"', expected: 'false' },
  ],
  hidden_tests: [
    { input: '"([)]"', expected: 'false' },
    { input: '"{[]}"', expected: 'true' },
    { input: '"("', expected: 'false' },
    { input: '")"', expected: 'false' },
    { input: '"(((((("', expected: 'false' },
    { input: '"([]){}[({})]"', expected: 'true' },
    { input: '"(((())))"', expected: 'true' },
    { input: '"}{"', expected: 'false' },
  ],
  target_complexity: { time: 'O(n)', space: 'O(n)' },
  brute_force_note:
    'Repeatedly deleting adjacent matching pairs until nothing changes is correct but O(n^2): every pass rescans the string. A stack does it in one pass.',
  hints: [
    'Which bracket has to be closed first — the one opened earliest, or the one opened most recently?',
    'Keep the brackets that are still open, in the order you saw them.',
    'Use a stack: push opening brackets, and check each closing bracket against the top.',
  ],
  reference_solution: {
    language: 'python',
    code: String.raw`class Solution:
    def isValid(self, s: str) -> bool:
        pairs = {")": "(", "]": "[", "}": "{"}
        stack = []
        for ch in s:
            if ch in pairs:
                if not stack or stack[-1] != pairs[ch]:
                    return False
                stack.pop()
            else:
                stack.append(ch)
        return not stack
`,
    commentary:
      'Push every opening bracket; on a closing bracket, the top of the stack must be its partner. The string is valid only if the stack ends empty.',
  },
  follow_up_question:
    'Your stack can grow as long as the input — is there any input you could reject before reading all of it?',
  skill_tags: ['stack', 'strings'],
};

const TWO_SUM: CodingChallengeDraft = {
  v: 3,
  title: 'Two Sum',
  topic: 'arrays_hashing',
  level: 'easy',
  problem_statement:
    'Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target, in increasing order. Every input has exactly one solution, and the same element may not be used twice.',
  constraints: [
    '2 <= nums.length <= 10^4',
    '-10^9 <= nums[i] <= 10^9',
    '-10^9 <= target <= 10^9',
    'Exactly one valid answer exists',
  ],
  input_format: 'nums — an array of integers; target — an integer.',
  output_format: 'The two indices, smaller first.',
  signature: {
    function_name: 'twoSum',
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'target', type: 'int' },
    ],
    return_type: 'int[]',
  },
  examples: [
    { input: 'nums = [2,7,11,15], target = 9', output: '[0,1]', explanation: 'nums[0] + nums[1] = 2 + 7 = 9.' },
    { input: 'nums = [3,2,4], target = 6', output: '[1,2]', explanation: 'nums[1] + nums[2] = 2 + 4 = 6.' },
  ],
  visible_tests: [
    { input: '[2,7,11,15]\n9', expected: '[0,1]' },
    { input: '[3,2,4]\n6', expected: '[1,2]' },
    { input: '[3,3]\n6', expected: '[0,1]' },
  ],
  hidden_tests: [
    { input: '[1,5,9,13]\n22', expected: '[2,3]' },
    { input: '[-3,4,3,90]\n0', expected: '[0,2]' },
    { input: '[0,4,3,0]\n0', expected: '[0,3]' },
    { input: '[1,2]\n3', expected: '[0,1]' },
    { input: '[5,75,25]\n100', expected: '[1,2]' },
    { input: '[10,-2,7,-8,3]\n-10', expected: '[1,3]' },
    { input: '[4,6,1,9,12,3]\n21', expected: '[3,4]' },
  ],
  target_complexity: { time: 'O(n)', space: 'O(n)' },
  brute_force_note:
    'Checking every pair is O(n^2) — about 5 * 10^7 pairs at n = 10^4. Remembering each value you have seen in a hash map finds the partner in one pass.',
  hints: [
    'For each number, what exact value would complete the pair?',
    'Could you look that value up instantly instead of scanning for it?',
    'Store each value with its index in a hash map as you go, and check for target - value first.',
  ],
  reference_solution: {
    language: 'python',
    code: String.raw`class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for j, value in enumerate(nums):
            if target - value in seen:
                return [seen[target - value], j]
            seen[value] = j
        return []
`,
    commentary:
      'One pass with a value-to-index map: before storing a value, check whether its complement has already been seen. Checking before storing is what stops an element pairing with itself, and it returns the earlier index first.',
  },
  follow_up_question:
    'If the array were already sorted, could you solve it without the extra memory — and what would that cost you?',
  skill_tags: ['hash map', 'arrays'],
};

const LONGEST_SUBSTRING: CodingChallengeDraft = {
  v: 3,
  title: 'Longest Substring Without Repeating Characters',
  topic: 'sliding_window',
  level: 'medium',
  problem_statement:
    'Given a string s, return the length of the longest substring that contains no repeated characters. A substring is a contiguous run of characters.',
  constraints: ['0 <= s.length <= 5 * 10^4', 's consists of English letters, digits, symbols and spaces'],
  input_format: 's — a string.',
  output_format: 'The length of the longest substring without repeating characters.',
  signature: {
    function_name: 'lengthOfLongestSubstring',
    params: [{ name: 's', type: 'string' }],
    return_type: 'int',
  },
  examples: [
    { input: 's = "abcabcbb"', output: '3', explanation: 'The answer is "abc", with length 3.' },
    { input: 's = "bbbbb"', output: '1', explanation: 'The answer is "b", with length 1.' },
    {
      input: 's = "pwwkew"',
      output: '3',
      explanation: 'The answer is "wke". "pwke" is not a substring — it is not contiguous.',
    },
  ],
  visible_tests: [
    { input: '"abcabcbb"', expected: '3' },
    { input: '"bbbbb"', expected: '1' },
    { input: '"pwwkew"', expected: '3' },
  ],
  hidden_tests: [
    { input: '""', expected: '0' },
    { input: '" "', expected: '1' },
    { input: '"au"', expected: '2' },
    { input: '"dvdf"', expected: '3' },
    { input: '"abba"', expected: '2' },
    { input: '"tmmzuxt"', expected: '5' },
    { input: '"abcdefghijklmnopqrstuvwxyz"', expected: '26' },
    { input: '"abcbde"', expected: '4' },
  ],
  target_complexity: { time: 'O(n)', space: 'O(min(n, alphabet))' },
  brute_force_note:
    'Checking every substring for duplicates is O(n^3), or O(n^2) with a set — far too slow at 5 * 10^4. A window that only ever moves forward visits each character a constant number of times.',
  hints: [
    'When you find a repeat, does the substring have to restart from scratch?',
    'Keep a window of characters with no repeats, and move its left edge only when you must.',
    "Remember the last index of each character; on a repeat, jump the window's start past it.",
  ],
  reference_solution: {
    language: 'python',
    code: String.raw`class Solution:
    def lengthOfLongestSubstring(self, s: str) -> int:
        last_seen = {}
        best = 0
        start = 0
        for i, ch in enumerate(s):
            if ch in last_seen and last_seen[ch] >= start:
                start = last_seen[ch] + 1
            last_seen[ch] = i
            best = max(best, i - start + 1)
        return best
`,
    commentary:
      "A sliding window over the string. The start only moves forward — past the previous occurrence of the current character, but only if that occurrence is inside the window, which is the case 'abba' tests.",
  },
  follow_up_question:
    'If s could contain any Unicode character, what would change about your memory use?',
  skill_tags: ['sliding window', 'hash map', 'strings'],
};

const TRAPPING_RAIN_WATER: CodingChallengeDraft = {
  v: 3,
  title: 'Trapping Rain Water',
  topic: 'two_pointers',
  level: 'hard',
  problem_statement:
    'Given n non-negative integers representing an elevation map where each bar has width 1, return how many units of water it can trap after raining.',
  constraints: ['1 <= height.length <= 2 * 10^4', '0 <= height[i] <= 10^5'],
  input_format: 'height — the bar heights, left to right.',
  output_format: 'The total units of trapped water.',
  signature: { function_name: 'trap', params: [{ name: 'height', type: 'int[]' }], return_type: 'int' },
  examples: [
    {
      input: 'height = [0,1,0,2,1,0,1,3,2,1,2,1]',
      output: '6',
      explanation: 'Water collects in the dips between the taller bars, 6 units in total.',
    },
    {
      input: 'height = [4,2,0,3,2,5]',
      output: '9',
      explanation: 'Every bar between the 4 and the 5 holds water up to height 4.',
    },
  ],
  visible_tests: [
    { input: '[0,1,0,2,1,0,1,3,2,1,2,1]', expected: '6' },
    { input: '[4,2,0,3,2,5]', expected: '9' },
  ],
  hidden_tests: [
    { input: '[1]', expected: '0' },
    { input: '[2,0,2]', expected: '2' },
    { input: '[3,0,0,2,0,4]', expected: '10' },
    { input: '[5,4,1,2]', expected: '1' },
    { input: '[0,0,0]', expected: '0' },
    { input: '[1,2,3,4,5]', expected: '0' },
    { input: '[5,1,1,1,5]', expected: '12' },
    { input: '[4,2,3]', expected: '1' },
  ],
  target_complexity: { time: 'O(n)', space: 'O(1)' },
  brute_force_note:
    'For each bar, scanning left and right for the tallest walls is O(n^2). Precomputed prefix and suffix maxima make it O(n) with O(n) memory; two pointers get the memory down to O(1).',
  hints: [
    'How much water sits above one bar? It depends on two other bars — which ones?',
    'The water above a bar is min(tallest to its left, tallest to its right) minus its own height.',
    'Walk two pointers inward, always moving the side with the lower wall — that side is already decided.',
  ],
  reference_solution: {
    language: 'python',
    code: String.raw`class Solution:
    def trap(self, height: List[int]) -> int:
        left, right = 0, len(height) - 1
        left_max = right_max = 0
        water = 0
        while left < right:
            if height[left] < height[right]:
                left_max = max(left_max, height[left])
                water += left_max - height[left]
                left += 1
            else:
                right_max = max(right_max, height[right])
                water += right_max - height[right]
                right -= 1
        return water
`,
    commentary:
      'Two pointers from both ends. Whichever side has the lower wall is bounded by that wall regardless of what lies between, so its water can be counted immediately and the pointer moved in.',
  },
  follow_up_question:
    'Your first instinct may have been prefix and suffix maxima — what exactly does the two-pointer version save, and what does it make harder to explain?',
  skill_tags: ['two pointers', 'arrays'],
};

const BANK = {
  validParentheses: finaliseCodingChallenge(VALID_PARENTHESES),
  twoSum: finaliseCodingChallenge(TWO_SUM),
  longestSubstring: finaliseCodingChallenge(LONGEST_SUBSTRING),
  trappingRainWater: finaliseCodingChallenge(TRAPPING_RAIN_WATER),
};

/** Preference order per interview difficulty: its own level first, then the nearest. */
const CODING_BANK: Record<'easy' | 'medium' | 'hard', CodingChallenge[]> = {
  easy: [BANK.validParentheses, BANK.twoSum, BANK.longestSubstring, BANK.trappingRainWater],
  medium: [BANK.longestSubstring, BANK.twoSum, BANK.trappingRainWater, BANK.validParentheses],
  hard: [BANK.trappingRainWater, BANK.longestSubstring, BANK.twoSum, BANK.validParentheses],
};

/** Every problem in the bank, for checks that need to walk all of them. */
export const CODING_FALLBACKS: readonly CodingChallenge[] = CODING_BANK.easy;

/**
 * A built-in problem for a failed coding slot.
 *
 * `usedTitles` holds the problems already in the round, generated or built-in,
 * so a round never repeats one. Always returns a problem — the bank has more
 * entries than a round has slots.
 */
export function fallbackCodingChallenge(
  difficulty: 'easy' | 'medium' | 'hard',
  usedTitles: Set<string>,
): CodingChallenge {
  const bank = CODING_BANK[difficulty];
  const pick = bank.find((p) => !usedTitles.has(p.title.toLowerCase())) ?? bank[0];
  return structuredClone(pick);
}

// ── Skill templates ──────────────────────────────────────────────────────────

const MINUTES: Record<'easy' | 'medium' | 'hard', number> = { easy: 8, medium: 10, hard: 12 };

const SQL_CONTEXT = String.raw`CREATE TABLE customers (
  customer_id INT PRIMARY KEY,
  name        TEXT NOT NULL,
  country     TEXT NOT NULL
);

CREATE TABLE orders (
  order_id    INT PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  ordered_at  DATE NOT NULL,
  amount      NUMERIC(10, 2) NOT NULL
);

INSERT INTO customers VALUES
  (1, 'Asha', 'IN'), (2, 'Ben', 'UK'), (3, 'Chen', 'SG'), (4, 'Dara', 'IN');

INSERT INTO orders VALUES
  (10, 1, '2024-01-05', 120.00),
  (11, 1, '2024-03-18',  80.00),
  (12, 2, '2024-02-11', 200.00),
  (13, 3, '2023-12-30',  50.00),
  (14, 3, '2024-06-02',  75.00),
  (15, 3, '2024-07-21',  60.00);`;

/** A query task on a fixed schema. Valid for any query-language skill. */
function sqlFallback(input: ChallengeInput, target: SkillTarget): SkillChallenge {
  const hard = input.difficulty === 'hard';

  return {
    v: 3,
    skill: target.skill,
    format: 'query',
    title: hard ? 'Repeat customers and their share of revenue' : 'Repeat customers in 2024',
    prompt: hard
      ? 'Return every customer who placed at least two orders in 2024, with their name, how many 2024 orders they placed, their total 2024 spend, and their share of ALL 2024 revenue as a percentage rounded to one decimal place. Sort by total spend, highest first. Columns: name, order_count, total_spend, revenue_share.'
      : 'Return every customer who placed at least two orders in 2024, with their name, how many 2024 orders they placed, and their total 2024 spend. Sort by total spend, highest first. Columns: name, order_count, total_spend.',
    context: SQL_CONTEXT,
    editor_language: 'sql',
    starter_code: '-- Tables: customers, orders (schema and sample rows above)\n-- Write your query below.\n\nSELECT\n',
    requirements: [
      { id: 'req_join', requirement: 'Joins orders to customers on customer_id', tier: 'must_have', weight: 2 },
      {
        id: 'req_year',
        requirement: 'Restricts to orders placed in 2024, by order date, before aggregating',
        tier: 'must_have',
        weight: 3,
      },
      {
        id: 'req_having',
        requirement: 'Keeps only customers with at least two 2024 orders using HAVING on the grouped count, not WHERE',
        tier: 'must_have',
        weight: 3,
      },
      {
        id: 'req_aggregate',
        requirement: 'Returns name, order_count and total_spend using COUNT and SUM over the grouped rows',
        tier: 'must_have',
        weight: 2,
      },
      ...(hard
        ? [
            {
              id: 'req_share',
              requirement:
                'Computes revenue_share against ALL 2024 revenue (a subquery or a window over the unfiltered rows), not only the customers that pass the filter',
              tier: 'must_have' as const,
              weight: 3,
            },
          ]
        : []),
      { id: 'req_order', requirement: 'Sorts by total spend, highest first', tier: 'good_to_have', weight: 1 },
    ],
    bug_summary: null,
    reference_solution: hard
      ? String.raw`SELECT c.name,
       COUNT(*)      AS order_count,
       SUM(o.amount) AS total_spend,
       ROUND(100.0 * SUM(o.amount) / (
         SELECT SUM(amount) FROM orders
         WHERE ordered_at >= '2024-01-01' AND ordered_at < '2025-01-01'
       ), 1)         AS revenue_share
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
WHERE o.ordered_at >= '2024-01-01' AND o.ordered_at < '2025-01-01'
GROUP BY c.customer_id, c.name
HAVING COUNT(*) >= 2
ORDER BY total_spend DESC;
-- On the sample rows: Asha 2 200.00 37.4, Chen 2 135.00 25.2`
      : String.raw`SELECT c.name,
       COUNT(*)      AS order_count,
       SUM(o.amount) AS total_spend
FROM orders o
JOIN customers c ON c.customer_id = o.customer_id
WHERE o.ordered_at >= '2024-01-01' AND o.ordered_at < '2025-01-01'
GROUP BY c.customer_id, c.name
HAVING COUNT(*) >= 2
ORDER BY total_spend DESC;
-- On the sample rows: Asha 2 200.00, Chen 2 135.00`,
    hints: [
      'Filter to 2024 first, then group — which clause filters the groups themselves?',
      'Chen has an order in 2023. Should it count towards the two?',
      ...(hard ? ['The share needs a total that the HAVING filter has not already removed rows from.'] : []),
    ],
    discussion_probes: [
      'Why does the two-order condition belong in HAVING rather than WHERE?',
      'How would you write the date filter so an index on ordered_at can still be used?',
      'What changes if amount can be NULL?',
    ],
    estimated_minutes: MINUTES[input.difficulty],
    skill_tags: [target.skill, 'sql'],
  };
}

/**
 * A written design walk-through in the skill. Works for any technology,
 * because it asks how the candidate would use it on this role's real work
 * rather than for code a reviewer could only judge by running it.
 */
function designFallback(input: ChallengeInput, target: SkillTarget): SkillChallenge {
  const skill = target.skill;
  const key = skill.toLowerCase();
  const responsibility =
    input.responsibilities?.find((r) => r.toLowerCase().includes(key)) ?? input.responsibilities?.[0];

  const task = responsibility
    ? `Here is part of this role's real work: "${responsibility}". Walk through how you would deliver it using ${skill}.`
    : `Walk through how you would build a small, production-ready feature for a ${input.roleTitle} role using ${skill}.`;

  return {
    v: 3,
    skill,
    format: 'design',
    title: `Building it with ${skill}`,
    prompt: `${task} Cover how you would structure it, the one decision you would think hardest about, how you would know it works, and what you would watch once it is live. Write short notes under the headings in the editor — then we will talk it through.`,
    context: target.derivedFrom ? `The posting asks for it like this: "${target.derivedFrom}"` : null,
    editor_language: 'markdown',
    starter_code: '## Structure\n\n\n## The hardest decision\n\n\n## How I would know it works\n\n\n## What I would watch in production\n',
    requirements: [
      {
        id: 'req_structure',
        requirement: `Describes a concrete structure using ${skill}, naming the actual pieces it would use rather than generalities`,
        tier: 'must_have',
        weight: 3,
      },
      {
        id: 'req_tradeoff',
        requirement: 'Names one real design decision and defends it against a specific alternative',
        tier: 'must_have',
        weight: 2,
      },
      {
        id: 'req_verification',
        requirement: 'Says specifically how correctness would be checked — what would be tested, and how',
        tier: 'good_to_have',
        weight: 2,
      },
      {
        id: 'req_operations',
        requirement: 'Identifies at least one realistic failure mode and how it would be noticed',
        tier: 'good_to_have',
        weight: 1,
      },
    ],
    bug_summary: null,
    reference_solution: `A strong answer names the concrete ${skill} building blocks it would use and how they fit together; commits to one real trade-off and says why the alternative loses in this situation; describes specific checks rather than "I would test it"; and names at least one way it fails in production and how that would be detected.`,
    hints: [
      'Start from the smallest version that would genuinely work, then say what you would add.',
      'Pick the decision you would expect to argue about in code review, and argue it.',
    ],
    discussion_probes: [
      'What would you cut if you had half the time?',
      'Which part of this breaks first at ten times the load?',
      'How would a teammate know your version works without reading all of it?',
    ],
    estimated_minutes: MINUTES[input.difficulty],
    skill_tags: [skill],
  };
}

/** A templated task for a failed skill slot, in the skill that slot was for. */
export function fallbackSkillChallenge(input: ChallengeInput, target: SkillTarget): SkillChallenge {
  return target.format === 'query' || target.editorLanguage === 'sql'
    ? sqlFallback(input, target)
    : designFallback(input, target);
}
