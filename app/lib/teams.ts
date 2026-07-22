import type { Character, Role } from "../data/seasons";

export type TeamConnection = { from: string; to: string };

export type RankedTeam = {
  members: Character[];
  connections: TeamConnection[];
  coveredMembers: number;
  completePackages: number;
  score: number;
  deadpoolRole?: Exclude<Role, "All" | "TBD">;
};

export type TeamResults = {
  balanced: RankedTeam[];
  open: RankedTeam[];
  combinationsChecked: number;
};

const fixedRoles: Array<Exclude<Role, "All" | "TBD">> = [
  "Vanguard",
  "Duelist",
  "Strategist",
];

function assignedDeadpoolRole(
  members: Character[],
  balanced: boolean,
): Exclude<Role, "All" | "TBD"> | undefined {
  if (!members.some((member) => member.name === "Deadpool")) return undefined;
  const counts = Object.fromEntries(fixedRoles.map((role) => [role, 0])) as Record<
    Exclude<Role, "All" | "TBD">,
    number
  >;
  members.forEach((member) => {
    if (member.role !== "All" && member.role !== "TBD") counts[member.role] += 1;
  });
  if (balanced) return fixedRoles.find((role) => counts[role] < 2);
  return [...fixedRoles].sort((a, b) => counts[a] - counts[b])[0];
}

function isBalancedIndices(indices: number[], characters: Character[]) {
  let vanguards = 0;
  let duelists = 0;
  let strategists = 0;
  let flex = 0;
  for (const index of indices) {
    const member = characters[index];
    if (member.role === "All") flex += 1;
    else if (member.role === "Vanguard") vanguards += 1;
    else if (member.role === "Duelist") duelists += 1;
    else if (member.role === "Strategist") strategists += 1;
  }
  if (vanguards > 2 || duelists > 2 || strategists > 2) return false;
  const missing = 6 - vanguards - duelists - strategists;
  return missing === flex;
}

function insertTop(result: RankedTeam[], team: RankedTeam, limit: number) {
  const isBetter = (a: RankedTeam, b: RankedTeam) =>
    a.score > b.score ||
    (a.score === b.score &&
      a.members.map((member) => member.name).join("|") <
        b.members.map((member) => member.name).join("|"));

  if (result.length === limit && !isBetter(team, result[result.length - 1])) return;
  let index = 0;
  while (index < result.length && isBetter(result[index], team)) index += 1;
  result.splice(index, 0, team);
  if (result.length > limit) result.pop();
}

function canEnterTop(result: RankedTeam[], score: number, limit: number) {
  return result.length < limit || score >= result[result.length - 1].score;
}

export function generateOptimalTeams(
  characters: Character[],
  selectedName: string,
  limit = 8,
): TeamResults {
  const available = characters.filter((character) => character.released);
  const selectedIndex = available.findIndex(
    (character) => character.name === selectedName,
  );
  if (selectedIndex < 0) {
    return { balanced: [], open: [], combinationsChecked: 0 };
  }

  const nameToIndex = new Map(
    available.map((character, index) => [character.name, index]),
  );
  const providerIndices = available.map((character) =>
    character.providers
      .map((provider) => nameToIndex.get(provider))
      .filter((index): index is number => index !== undefined),
  );
  const candidates = available
    .map((_, index) => index)
    .filter((index) => index !== selectedIndex);
  const inTeam = new Uint8Array(available.length);
  const chosen = [selectedIndex];
  inTeam[selectedIndex] = 1;

  const balanced: RankedTeam[] = [];
  const open: RankedTeam[] = [];
  let combinationsChecked = 0;

  const evaluate = () => {
    combinationsChecked += 1;
    let activeLinks = 0;
    let coveredMembers = 0;
    let completePackages = 0;

    for (const recipientIndex of chosen) {
      let activeForRecipient = 0;
      for (const providerIndex of providerIndices[recipientIndex]) {
        if (!inTeam[providerIndex]) continue;
        activeLinks += 1;
        activeForRecipient += 1;
      }
      if (activeForRecipient > 0) coveredMembers += 1;
      if (
        providerIndices[recipientIndex].length > 1 &&
        activeForRecipient === providerIndices[recipientIndex].length
      ) {
        completePackages += 1;
      }
    }

    // Receiving coverage is the goal: a hero only counts when one of their
    // listed providers is also on the team. Extra links break coverage ties.
    const score = coveredMembers * 10_000 + activeLinks * 100 + completePackages * 10;
    const balancedTeam = isBalancedIndices(chosen, available);
    const qualifiesForOpen = canEnterTop(open, score, limit);
    const qualifiesForBalanced = balancedTeam && canEnterTop(balanced, score, limit);
    if (!qualifiesForOpen && !qualifiesForBalanced) return;

    const members = chosen.map((index) => available[index]);
    const connections: TeamConnection[] = [];
    for (const recipientIndex of chosen) {
      for (const providerIndex of providerIndices[recipientIndex]) {
        if (inTeam[providerIndex]) {
          connections.push({
            from: available[providerIndex].name,
            to: available[recipientIndex].name,
          });
        }
      }
    }
    const common = { members, connections, coveredMembers, completePackages, score };
    if (qualifiesForOpen) {
      insertTop(
        open,
        { ...common, deadpoolRole: assignedDeadpoolRole(members, false) },
        limit,
      );
    }
    if (qualifiesForBalanced) {
      insertTop(
        balanced,
        { ...common, deadpoolRole: assignedDeadpoolRole(members, true) },
        limit,
      );
    }
  };

  const search = (start: number) => {
    if (chosen.length === 6) {
      evaluate();
      return;
    }
    const stillNeeded = 6 - chosen.length;
    const lastStart = candidates.length - stillNeeded;
    for (let position = start; position <= lastStart; position += 1) {
      const index = candidates[position];
      chosen.push(index);
      inTeam[index] = 1;
      search(position + 1);
      inTeam[index] = 0;
      chosen.pop();
    }
  };

  search(0);
  return { balanced, open, combinationsChecked };
}

export function orderedTeamMembers(team: RankedTeam) {
  const roleOrder: Record<string, number> = {
    Vanguard: 0,
    Duelist: 1,
    Strategist: 2,
  };
  return [...team.members].sort((a, b) => {
    const roleA = a.role === "All" ? team.deadpoolRole ?? "Duelist" : a.role;
    const roleB = b.role === "All" ? team.deadpoolRole ?? "Duelist" : b.role;
    return roleOrder[roleA] - roleOrder[roleB] || a.name.localeCompare(b.name);
  });
}
