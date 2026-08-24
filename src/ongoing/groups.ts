import { shuffle } from './schedule';

export const isPowerOfTwo = (value: number): boolean =>
  Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;

// Round-robin dealing (not slicing) keeps group sizes within one of each other for any team/group count.
export const dealIntoGroups = (
  teamIds: string[],
  groupCount: number,
  random: () => number = Math.random,
): string[][] => {
  const groups: string[][] = [];
  for (let i = 0; i < groupCount; i += 1) groups.push([]);

  const shuffled = shuffle(teamIds, random);
  for (let i = 0; i < shuffled.length; i += 1) {
    groups[i % groupCount].push(shuffled[i]);
  }

  return groups;
};
