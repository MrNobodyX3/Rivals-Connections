"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { seasons, type Character, type Role } from "../data/seasons";
import {
  generateOptimalTeams,
  orderedTeamMembers,
  type RankedTeam,
  type TeamResults,
} from "../lib/teams";

type GraphEdge = { source: string; target: string };
type Point = { x: number; y: number };
type EdgePorts = { startAngle: number; endAngle: number };
type RoleFilter = "All heroes" | Exclude<Role, "All" | "TBD">;
type ViewMode = "network" | "ranking";
type GraphSize = { width: number; height: number };
type ChainDirection = "incoming" | "outgoing";
type ChainStep = {
  name: string;
  direction?: ChainDirection;
  parent?: string;
  order: number;
};

const NODE_RADIUS = 26;
const DEFAULT_GRAPH_SIZE: GraphSize = { width: 1400, height: 680 };
const roleOrder: RoleFilter[] = [
  "All heroes",
  "Vanguard",
  "Duelist",
  "Strategist",
];
const selectionRoleOrder: Array<{ role: Role; label: string }> = [
  { role: "Vanguard", label: "Vanguard" },
  { role: "Duelist", label: "Duelist" },
  { role: "Strategist", label: "Strategist" },
  { role: "All", label: "Flex" },
  { role: "TBD", label: "TBD" },
];

function getRoleCenters({ width, height }: GraphSize): Record<Role, Point> {
  return {
    Vanguard: { x: width * 0.15, y: height * 0.53 },
    Duelist: { x: width * 0.5, y: height * 0.53 },
    Strategist: { x: width * 0.85, y: height * 0.53 },
    All: { x: width * 0.5, y: height * 0.13 },
    TBD: { x: width * 0.85, y: height * 0.88 },
  };
}

function getRoleLane(role: Role, { width }: GraphSize) {
  const outerPadding = width < 700 ? 34 : 62;
  const laneGap = width < 700 ? 9 : Math.min(34, width * 0.025);
  const vanguardEnd = width * 0.3;
  const strategistStart = width * 0.7;

  if (role === "Vanguard") {
    return { minX: outerPadding, maxX: vanguardEnd - laneGap };
  }
  if (role === "Strategist" || role === "TBD") {
    return { minX: strategistStart + laneGap, maxX: width - outerPadding };
  }
  return {
    minX: vanguardEnd + laneGap,
    maxX: strategistStart - laneGap,
  };
}

function clampPointToRole(point: Point, role: Role, graphSize: GraphSize) {
  const lane = getRoleLane(role, graphSize);
  const topPadding = graphSize.width < 700 ? 54 : 86;
  const bottomPadding = graphSize.width < 700 ? 38 : 52;
  point.x = Math.min(lane.maxX, Math.max(lane.minX, point.x));
  point.y = Math.min(
    graphSize.height - bottomPadding,
    Math.max(topPadding, point.y),
  );
}

function getMinimumNodeDistance({ width, height }: GraphSize) {
  const minimum = width < 700 ? 40 : 70;
  return Math.max(minimum, Math.min(94, width / 15, height / 6.5));
}

function getNodeRadius({ width }: GraphSize) {
  return width < 700 ? 17 : NODE_RADIUS;
}

function stabilizeGraphDimension(value: number, step: number, minimum: number) {
  return Math.max(minimum, Math.round(value / step) * step);
}

function hashName(name: string) {
  return [...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

function characterImageFilename(name: string) {
  const camelCaseName = name
    .replace(/&/g, " And ")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return `${camelCaseName}.webp`;
}

type LayoutLane = "vanguard" | "duelist" | "strategist";

function getLayoutLane(role: Role): LayoutLane {
  if (role === "Vanguard") return "vanguard";
  if (role === "Strategist" || role === "TBD") return "strategist";
  return "duelist";
}

function createHexCells(
  role: Role,
  count: number,
  graphSize: GraphSize,
  preferredSpacing: number,
) {
  const lane = getRoleLane(role, graphSize);
  const top = graphSize.width < 700 ? 58 : 94;
  const bottom = graphSize.height - (graphSize.width < 700 ? 42 : 58);
  const minimumSpacing = graphSize.width < 700 ? 38 : 66;
  let spacing = preferredSpacing;
  let cells: Point[] = [];

  while (spacing >= minimumSpacing) {
    cells = [];
    const rowStep = spacing * 0.866;
    let row = 0;
    for (let y = top; y <= bottom; y += rowStep) {
      const offset = row % 2 === 0 ? 0 : spacing * 0.5;
      for (let x = lane.minX + offset; x <= lane.maxX; x += spacing) {
        cells.push({ x, y });
      }
      row += 1;
    }
    if (cells.length >= count) break;
    spacing -= 3;
  }

  return { cells, spacing };
}

function createLayout(characters: Character[], edges: GraphEdge[], graphSize: GraphSize) {
  const roleCenters = getRoleCenters(graphSize);
  const preferredSpacing = getMinimumNodeDistance(graphSize) * 0.94;
  const adjacency = new Map<string, Set<string>>(
    characters.map((character) => [character.name, new Set<string>()]),
  );
  edges.forEach((edge) => {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const laneCharacters = new Map<LayoutLane, Character[]>([
    ["vanguard", []],
    ["duelist", []],
    ["strategist", []],
  ]);
  characters.forEach((character) => {
    laneCharacters.get(getLayoutLane(character.role))!.push(character);
  });

  const lanePools = new Map<LayoutLane, { available: Point[]; spacing: number }>();
  (["vanguard", "duelist", "strategist"] as LayoutLane[]).forEach((laneName) => {
    const group = laneCharacters.get(laneName)!;
    const representativeRole: Role =
      laneName === "vanguard"
        ? "Vanguard"
        : laneName === "strategist"
          ? "Strategist"
          : "Duelist";
    const grid = createHexCells(
      representativeRole,
      group.length,
      graphSize,
      preferredSpacing,
    );
    lanePools.set(laneName, { available: grid.cells, spacing: grid.spacing });
  });

  const orderedCharacters = [...characters].sort((a, b) => {
    const degreeDifference =
      (adjacency.get(b.name)?.size ?? 0) - (adjacency.get(a.name)?.size ?? 0);
    return degreeDifference || a.name.localeCompare(b.name);
  });
  const points = new Map<string, Point>();
  const laneAssignments = new Map<LayoutLane, string[]>([
    ["vanguard", []],
    ["duelist", []],
    ["strategist", []],
  ]);

  orderedCharacters.forEach((character) => {
    const laneName = getLayoutLane(character.role);
    const pool = lanePools.get(laneName)!;
    const center = roleCenters[character.role];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;

    pool.available.forEach((cell, index) => {
      let score =
        Math.abs(cell.x - center.x) * 0.035 +
        Math.abs(cell.y - center.y) * 0.018 +
        (hashName(`${character.name}:${index}`) % 19) * 0.001;

      adjacency.get(character.name)?.forEach((neighborName) => {
        const neighborPoint = points.get(neighborName);
        if (!neighborPoint) return;
        const neighborCharacter = characters.find(
          (candidate) => candidate.name === neighborName,
        );
        const neighborLane = neighborCharacter
          ? getLayoutLane(neighborCharacter.role)
          : laneName;
        const neighborSpacing = lanePools.get(neighborLane)?.spacing ?? pool.spacing;
        const minimumConnectedDistance =
          Math.min(pool.spacing, neighborSpacing) * 1.72;
        const distance = Math.hypot(
          cell.x - neighborPoint.x,
          cell.y - neighborPoint.y,
        );
        if (distance < minimumConnectedDistance) {
          const shortfall = minimumConnectedDistance - distance;
          score += 1_000_000 + shortfall * shortfall * 250;
        } else {
          score += Math.abs(distance - minimumConnectedDistance * 1.35) * 0.025;
        }
      });

      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    const [chosenCell] = pool.available.splice(bestIndex, 1);
    points.set(character.name, chosenCell);
    laneAssignments.get(laneName)!.push(character.name);
  });

  const connectedPenalty = (layout: Map<string, Point>) => {
    let penalty = 0;
    edges.forEach((edge) => {
      const source = layout.get(edge.source);
      const target = layout.get(edge.target);
      if (!source || !target) return;
      const sourceCharacter = characters.find(
        (character) => character.name === edge.source,
      );
      const targetCharacter = characters.find(
        (character) => character.name === edge.target,
      );
      if (!sourceCharacter || !targetCharacter) return;
      const sourceSpacing =
        lanePools.get(getLayoutLane(sourceCharacter.role))?.spacing ?? preferredSpacing;
      const targetSpacing =
        lanePools.get(getLayoutLane(targetCharacter.role))?.spacing ?? preferredSpacing;
      const minimumDistance = Math.min(sourceSpacing, targetSpacing) * 1.72;
      const distance = Math.hypot(target.x - source.x, target.y - source.y);
      if (distance < minimumDistance) {
        const shortfall = minimumDistance - distance;
        penalty += shortfall * shortfall * 100;
      }
    });
    return penalty;
  };

  let currentPenalty = connectedPenalty(points);
  let randomState = 0x9e3779b9;
  const nextRandom = () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };

  for (let iteration = 0; iteration < 2400 && currentPenalty > 0; iteration += 1) {
    const laneNames = (["vanguard", "duelist", "strategist"] as LayoutLane[]).filter(
      (laneName) => laneAssignments.get(laneName)!.length > 1,
    );
    const laneName = laneNames[Math.floor(nextRandom() * laneNames.length)];
    const names = laneAssignments.get(laneName)!;
    const firstIndex = Math.floor(nextRandom() * names.length);
    let secondIndex = Math.floor(nextRandom() * names.length);
    if (firstIndex === secondIndex) secondIndex = (secondIndex + 1) % names.length;
    const firstName = names[firstIndex];
    const secondName = names[secondIndex];
    const firstPoint = points.get(firstName)!;
    const secondPoint = points.get(secondName)!;
    points.set(firstName, secondPoint);
    points.set(secondName, firstPoint);
    const nextPenalty = connectedPenalty(points);
    if (nextPenalty <= currentPenalty) {
      currentPenalty = nextPenalty;
    } else {
      points.set(firstName, firstPoint);
      points.set(secondName, secondPoint);
    }
  }

  return points;
}

function createHoverTarget(
  baseLayout: Map<string, Point>,
  characters: Character[],
  hoveredName: string | null,
  graphSize: GraphSize,
) {
  const target = new Map<string, Point>(
    characters.map((character): [string, Point] => {
      const point = baseLayout.get(character.name)!;
      return [character.name, { ...point }];
    }),
  );
  if (!hoveredName) return target;

  const center = target.get(hoveredName);
  if (!center) return target;
  const minimumDistance = getMinimumNodeDistance(graphSize);
  const pushRadius = minimumDistance * 2.7;

  characters.forEach((character) => {
    if (character.name === hoveredName) return;
    const point = target.get(character.name)!;
    let dx = point.x - center.x;
    let dy = point.y - center.y;
    let distance = Math.sqrt(dx * dx + dy * dy);
    if (distance >= pushRadius) return;
    if (distance < 1) {
      const angle = (hashName(character.name) % 360) * (Math.PI / 180);
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      distance = 1;
    }
    const influence = 1 - distance / pushRadius;
    const push = 10 + influence * influence * minimumDistance * 0.72;
    point.x += (dx / distance) * push;
    point.y += (dy / distance) * push;
  });

  // A short collision pass prevents the pushed nodes from landing on neighbors.
  for (let pass = 0; pass < 5; pass += 1) {
    for (let i = 0; i < characters.length; i += 1) {
      const a = characters[i];
      const pointA = target.get(a.name)!;
      for (let j = i + 1; j < characters.length; j += 1) {
        const b = characters[j];
        const pointB = target.get(b.name)!;
        let dx = pointB.x - pointA.x;
        let dy = pointB.y - pointA.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const collisionDistance = minimumDistance * 1.02;
        if (distance >= collisionDistance) continue;
        if (distance < 1) {
          dx = 1;
          dy = 0;
          distance = 1;
        }
        const overlap = collisionDistance - distance;
        const unitX = dx / distance;
        const unitY = dy / distance;
        if (a.name === hoveredName) {
          pointB.x += unitX * overlap;
          pointB.y += unitY * overlap;
        } else if (b.name === hoveredName) {
          pointA.x -= unitX * overlap;
          pointA.y -= unitY * overlap;
        } else {
          pointA.x -= unitX * overlap * 0.5;
          pointA.y -= unitY * overlap * 0.5;
          pointB.x += unitX * overlap * 0.5;
          pointB.y += unitY * overlap * 0.5;
        }
      }
    }
  }

  characters.forEach((character) => {
    const point = target.get(character.name)!;
    clampPointToRole(point, character.role, graphSize);
  });
  return target;
}

function initials(name: string) {
  const words = name.replace("&", " ").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

function roleClass(role: Role) {
  return role === "All" ? "flex" : role.toLowerCase();
}

function CharacterPortrait({ name, className }: { name: string; className: string }) {
  const [hasImage, setHasImage] = useState(true);

  return (
    <span className={`portrait-frame ${className}`} aria-hidden="true">
      {hasImage ? (
        <img
          src={`characters/${characterImageFilename(name)}`}
          alt=""
          onError={() => setHasImage(false)}
        />
      ) : (
        <span className="portrait-fallback">{initials(name)}</span>
      )}
    </span>
  );
}

const PORT_COUNT = 16;
const PORT_STEP = (Math.PI * 2) / PORT_COUNT;
const PORT_ZERO_ANGLE = -Math.PI / 2;

function edgeKey(edge: GraphEdge) {
  return `${edge.source}\u0000${edge.target}`;
}

function normalizeSlot(slot: number) {
  return ((slot % PORT_COUNT) + PORT_COUNT) % PORT_COUNT;
}

function angleToPort(angle: number) {
  return normalizeSlot(Math.round((angle - PORT_ZERO_ANGLE) / PORT_STEP));
}

function portToAngle(port: number) {
  return PORT_ZERO_ANGLE + normalizeSlot(port) * PORT_STEP;
}

function nearestAvailablePort(
  desiredPort: number,
  occupied: Set<number>,
  preferredVerticalSide: -1 | 0 | 1 = 0,
) {
  const candidates: number[] = [];
  for (let distance = 0; distance < PORT_COUNT; distance += 1) {
    const clockwise = normalizeSlot(desiredPort + distance);
    if (!candidates.includes(clockwise)) candidates.push(clockwise);
    if (distance === 0) continue;
    const counterClockwise = normalizeSlot(desiredPort - distance);
    if (!candidates.includes(counterClockwise)) candidates.push(counterClockwise);
  }

  if (preferredVerticalSide !== 0) {
    const sameSidePort = candidates.find((port) => {
      if (occupied.has(port)) return false;
      const verticalDirection = Math.sin(portToAngle(port));
      return preferredVerticalSide < 0
        ? verticalDirection <= 0
        : verticalDirection >= 0;
    });
    if (sameSidePort !== undefined) return sameSidePort;
  }

  const availablePort = candidates.find((port) => !occupied.has(port));
  if (availablePort !== undefined) return availablePort;
  return desiredPort;
}

function createEdgePorts(
  layout: Map<string, Point>,
  edges: GraphEdge[],
  nodeRadius: number,
) {
  const ports = new Map<string, EdgePorts>(
    edges.map((edge) => [edgeKey(edge), { startAngle: 0, endAngle: 0 }]),
  );
  const startsByCharacter = new Map<string, GraphEdge[]>();
  const endsByCharacter = new Map<string, GraphEdge[]>();

  edges.forEach((edge) => {
    startsByCharacter.set(edge.source, [
      ...(startsByCharacter.get(edge.source) ?? []),
      edge,
    ]);
    endsByCharacter.set(edge.target, [
      ...(endsByCharacter.get(edge.target) ?? []),
      edge,
    ]);
  });

  layout.forEach((center, characterName) => {
    const occupied = new Set<number>();
    const starts = [...(startsByCharacter.get(characterName) ?? [])].sort(
      (a, b) => a.target.localeCompare(b.target),
    );
    const ends = [...(endsByCharacter.get(characterName) ?? [])].sort(
      (a, b) => a.source.localeCompare(b.source),
    );

    starts.forEach((edge) => {
      const target = layout.get(edge.target)!;
      const desiredPort = angleToPort(
        Math.atan2(target.y - center.y, target.x - center.x),
      );
      const port = nearestAvailablePort(desiredPort, occupied);
      occupied.add(port);
      ports.get(edgeKey(edge))!.startAngle = portToAngle(port);
    });

    ends.forEach((edge) => {
      const source = layout.get(edge.source)!;
      const startAngle = ports.get(edgeKey(edge))!.startAngle;
      const startPoint = {
        x: source.x + Math.cos(startAngle) * (nodeRadius + 7),
        y: source.y + Math.sin(startAngle) * (nodeRadius + 7),
      };
      const desiredPort = angleToPort(
        Math.atan2(startPoint.y - center.y, startPoint.x - center.x),
      );
      const verticalDifference = startPoint.y - center.y;
      const preferredVerticalSide: -1 | 0 | 1 =
        Math.abs(verticalDifference) < nodeRadius * 0.25
          ? 0
          : verticalDifference < 0
            ? -1
            : 1;
      const port = nearestAvailablePort(
        desiredPort,
        occupied,
        preferredVerticalSide,
      );
      occupied.add(port);
      ports.get(edgeKey(edge))!.endAngle = portToAngle(port);
    });
  });

  return ports;
}

function edgePath(
  source: Point,
  target: Point,
  ports: EdgePorts,
  nodeRadius: number,
) {
  const sourceDirection = {
    x: Math.cos(ports.startAngle),
    y: Math.sin(ports.startAngle),
  };
  const targetDirection = {
    x: Math.cos(ports.endAngle),
    y: Math.sin(ports.endAngle),
  };
  const start = {
    x: source.x + sourceDirection.x * (nodeRadius + 7),
    y: source.y + sourceDirection.y * (nodeRadius + 7),
  };
  const end = {
    x: target.x + targetDirection.x * (nodeRadius + 12),
    y: target.y + targetDirection.y * (nodeRadius + 12),
  };
  const distance = Math.max(Math.hypot(end.x - start.x, end.y - start.y), 1);
  const handle = Math.min(82, Math.max(26, distance * 0.28));
  const controlOne = {
    x: start.x + sourceDirection.x * handle,
    y: start.y + sourceDirection.y * handle,
  };
  const controlTwo = {
    x: end.x + targetDirection.x * handle,
    y: end.y + targetDirection.y * handle,
  };

  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${controlOne.x.toFixed(1)} ${controlOne.y.toFixed(1)} ${controlTwo.x.toFixed(1)} ${controlTwo.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

function TeamCard({
  team,
  index,
  selectedName,
  onSelect,
}: {
  team: RankedTeam;
  index: number;
  selectedName: string;
  onSelect: (team: RankedTeam) => void;
}) {
  const members = orderedTeamMembers(team);
  const activeLinks = team.connections.length;
  const connectionGroups = members.flatMap((member) => {
    const providers = team.connections
      .filter((connection) => connection.to === member.name)
      .map((connection) => connection.from);
    return providers.length > 0 ? [{ recipient: member.name, providers }] : [];
  });
  const allConnected = team.coveredMembers === team.members.length;
  return (
    <article
      className="team-card"
      role="button"
      tabIndex={0}
      aria-label={`Show team ${index + 1} on the connection web`}
      onClick={() => onSelect(team)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(team);
        }
      }}
    >
      <div className="team-card-head">
        <span className="rank">#{String(index + 1).padStart(2, "0")}</span>
        <div className="score-cluster">
          <strong>{activeLinks} active links</strong>
          <span>{allConnected ? "Every hero receives a team-up" : `${team.coveredMembers} heroes receive a team-up`}</span>
        </div>
        {allConnected && <span className="coverage-badge is-complete">All connected</span>}
      </div>
      <div className="team-members">
        {members.map((member) => {
          const displayedRole =
            member.role === "All" ? team.deadpoolRole ?? "Duelist" : member.role;
          return (
            <div
              className={`member-chip ${roleClass(displayedRole)} ${member.name === selectedName ? "is-selected" : ""}`}
              key={member.name}
            >
              <CharacterPortrait
                name={member.name}
                className={`member-monogram ${roleClass(displayedRole)}`}
              />
              <span>
                <strong>{member.name}</strong>
                <small>
                  {member.role === "All" ? `Flex → ${displayedRole}` : displayedRole}
                </small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="connection-map" aria-label="Working team-up routes">
        <span className="connection-map-label">Working routes · provider → recipient</span>
        <div className="connection-routes">
          {connectionGroups.map(({ recipient, providers }) => (
            <div className="connection-route" key={recipient}>
              <span className="route-providers">{providers.join(" + ")}</span>
              <b aria-hidden="true">→</b>
              <span className="route-recipient">{recipient}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="team-card-action">
        View on connection web <span aria-hidden="true">↗</span>
      </div>
    </article>
  );
}

function TeamSection({
  eyebrow,
  title,
  description,
  teams,
  selectedName,
  onSelectTeam,
}: {
  eyebrow: string;
  title: string;
  description: string;
  teams: RankedTeam[];
  selectedName: string;
  onSelectTeam: (team: RankedTeam) => void;
}) {
  return (
    <section className="team-section">
      <div className="section-heading">
        <span>{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="team-list">
        {teams.length > 0 ? teams.map((team, index) => (
          <TeamCard
            team={team}
            index={index}
            selectedName={selectedName}
            onSelect={onSelectTeam}
            key={team.members.map((m) => m.name).join("-")}
          />
        )) : <p className="empty-team-results">No teams in this section match the selected chain.</p>}
      </div>
    </section>
  );
}

export function ConnectionsExplorer() {
  const [seasonId, setSeasonId] = useState(seasons[0].id);
  const [viewMode, setViewMode] = useState<ViewMode>("network");
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [rankingHoveredName, setRankingHoveredName] = useState<string | null>(null);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [pinnedNames, setPinnedNames] = useState<Set<string>>(() => new Set());
  const [failedImageNames, setFailedImageNames] = useState<Set<string>>(() => new Set());
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [chainSteps, setChainSteps] = useState<ChainStep[]>([]);
  const [chainFocus, setChainFocus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("All heroes");
  const [teamResults, setTeamResults] = useState<TeamResults | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [graphSize, setGraphSize] = useState(DEFAULT_GRAPH_SIZE);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const hoverLeaveTimerRef = useRef<number | null>(null);
  const chainSequenceRef = useRef(0);
  const cache = useRef(new Map<string, TeamResults>());

  useEffect(() => () => {
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const element = graphContainerRef.current;
    if (!element) return;
    let frame = 0;
    const updateSize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 320 || rect.height < 280) return;
        setGraphSize((current) => {
          const width = Math.round(rect.width);
          const height = Math.round(rect.height);
          return Math.abs(current.width - width) < 2 && Math.abs(current.height - height) < 2
            ? current
            : { width, height };
        });
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    updateSize();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const season = seasons.find((item) => item.id === seasonId) ?? seasons[0];
  const characters = season.characters;
  const chainMembers = useMemo(() => chainSteps.map((step) => step.name), [chainSteps]);
  const characterMap = useMemo(
    () => new Map(characters.map((character) => [character.name, character])),
    [characters],
  );
  const edges = useMemo(
    () =>
      characters.flatMap((character) =>
        character.providers
          .filter((provider) => characterMap.has(provider))
          .map((provider) => ({ source: provider, target: character.name })),
    ),
    [characters, characterMap],
  );
  const stableGraphWidth = stabilizeGraphDimension(
    graphSize.width,
    graphSize.width < 700 ? 48 : 120,
    320,
  );
  const stableGraphHeight = stabilizeGraphDimension(
    graphSize.height,
    graphSize.width < 700 ? 48 : 96,
    288,
  );
  const layoutSize = useMemo(
    () => ({ width: stableGraphWidth, height: stableGraphHeight }),
    [stableGraphHeight, stableGraphWidth],
  );
  const roleCenters = useMemo(() => getRoleCenters(layoutSize), [layoutSize]);
  const nodeRadius = getNodeRadius(layoutSize);
  const layout = useMemo(
    () => createLayout(characters, edges, layoutSize),
    [characters, edges, layoutSize],
  );
  const edgePorts = useMemo(
    () => createEdgePorts(layout, edges, nodeRadius),
    [edges, layout, nodeRadius],
  );
  const [displayLayout, setDisplayLayout] = useState(layout);
  const displayLayoutRef = useRef(layout);

  useEffect(() => {
    const startLayout = displayLayoutRef.current;
    const layoutHoverName = isMultiSelect ? null : hoveredName;
    const targetLayout = createHoverTarget(layout, characters, layoutHoverName, layoutSize);
    const startedAt = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 220;
    let animationFrame = 0;

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextLayout = new Map<string, Point>();
      characters.forEach((character) => {
        const from = startLayout.get(character.name) ?? layout.get(character.name)!;
        const to = targetLayout.get(character.name) ?? from;
        nextLayout.set(character.name, {
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased,
        });
      });
      displayLayoutRef.current = nextLayout;
      setDisplayLayout(nextLayout);
      if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [characters, hoveredName, isMultiSelect, layout, layoutSize]);

  const recipients = useMemo(() => {
    const map = new Map<string, string[]>();
    edges.forEach((edge) => map.set(edge.source, [...(map.get(edge.source) ?? []), edge.target]));
    return map;
  }, [edges]);
  const connectionRanking = useMemo(() => {
    const incoming = new Map<string, number>();
    const outgoing = new Map<string, number>();
    edges.forEach((edge) => {
      outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
      incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    });
    return characters
      .map((character) => {
        const incomingCount = incoming.get(character.name) ?? 0;
        const outgoingCount = outgoing.get(character.name) ?? 0;
        return {
          character,
          incoming: incomingCount,
          outgoing: outgoingCount,
          total: incomingCount + outgoingCount,
        };
      })
      .sort((a, b) => a.total - b.total || a.character.name.localeCompare(b.character.name));
  }, [characters, edges]);
  const maxConnectionCount = Math.max(...connectionRanking.map((item) => item.total), 1);

  const activeName = isMultiSelect && pinnedNames.size > 0
    ? null
    : hoveredName ?? (isMultiSelect ? null : selectedName);
  const activeCharacter = activeName ? characterMap.get(activeName) : undefined;
  const highlightedNames = useMemo(() => {
    if (isMultiSelect) {
      const names = new Set(pinnedNames);
      if (hoveredName) names.add(hoveredName);
      return names;
    }
    const singleName = hoveredName ?? selectedName;
    return singleName ? new Set([singleName]) : new Set<string>();
  }, [hoveredName, isMultiSelect, pinnedNames, selectedName]);
  const connectedNames = useMemo(() => {
    if (highlightedNames.size === 0) return new Set<string>();
    if (isMultiSelect) {
      const names = new Set(pinnedNames);
      if (!hoveredName) return names;
      names.add(hoveredName);
      edges.forEach((edge) => {
        if (edge.source === hoveredName) names.add(edge.target);
        if (edge.target === hoveredName) names.add(edge.source);
      });
      return names;
    }
    const names = new Set(highlightedNames);
    edges.forEach((edge) => {
      if (highlightedNames.has(edge.source)) names.add(edge.target);
      if (highlightedNames.has(edge.target)) names.add(edge.source);
    });
    return names;
  }, [edges, highlightedNames, hoveredName, isMultiSelect, pinnedNames]);

  useEffect(() => {
    if (!selectedName) return;
    const selected = characterMap.get(selectedName);
    if (!selected?.released) return;
    const requiredNames = chainMembers.length > 0 ? chainMembers : [selectedName];
    const cacheKey = `${season.id}:${[...new Set(requiredNames)].sort().join("|")}`;
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setTeamResults(cached);
      setIsGenerating(false);
      return;
    }
    setTeamResults(null);
    setIsGenerating(true);
    const timer = window.setTimeout(() => {
      const result = generateOptimalTeams(characters, selectedName, 8, requiredNames);
      cache.current.set(cacheKey, result);
      setTeamResults(result);
      setIsGenerating(false);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [selectedName, season.id, characters, characterMap, chainMembers]);

  const selectedCharacter = selectedName ? characterMap.get(selectedName) : undefined;
  const focusedChainCharacter = chainFocus ? characterMap.get(chainFocus) : selectedCharacter;
  const incomingChainOptions = focusedChainCharacter
    ? focusedChainCharacter.providers.filter((name) => characterMap.get(name)?.released && !chainMembers.includes(name))
    : [];
  const outgoingChainOptions = focusedChainCharacter
    ? (recipients.get(focusedChainCharacter.name) ?? []).filter((name) => characterMap.get(name)?.released && !chainMembers.includes(name))
    : [];
  const normalizedSearch = search.trim().toLowerCase();

  const openTeamBuilder = (name: string) => {
    const character = characterMap.get(name);
    const cached = cache.current.get(`${season.id}:${name}`) ?? null;
    const activeElement = document.activeElement;
    previousFocusRef.current =
      activeElement instanceof HTMLElement || activeElement instanceof SVGElement
        ? activeElement
        : null;
    setSelectedName(name);
    chainSequenceRef.current = 0;
    setChainSteps([{ name, order: 0 }]);
    setChainFocus(name);
    setTeamResults(cached);
    setIsGenerating(Boolean(character?.released && !cached));
  };

  const closeTeamBuilder = () => {
    setSelectedName(null);
    setChainSteps([]);
    setChainFocus(null);
    setTeamResults(null);
    setIsGenerating(false);
  };

  const showTeamOnNetwork = (team: RankedTeam) => {
    setPinnedNames(new Set(team.members.map((member) => member.name)));
    setIsMultiSelect(true);
    setHoveredName(null);
    setViewMode("network");
    closeTeamBuilder();
  };

  const addChainMember = (name: string, direction: ChainDirection) => {
    setChainSteps((steps) => {
      if (steps.length >= 6 || steps.some((step) => step.name === name)) return steps;
      const parent = chainFocus ?? selectedName ?? undefined;
      const focusedIndex = steps.findIndex((step) => step.name === parent);
      const insertionIndex = focusedIndex < 0
        ? steps.length
        : direction === "incoming"
          ? focusedIndex
          : focusedIndex + 1;
      const next = [...steps];
      chainSequenceRef.current += 1;
      next.splice(insertionIndex, 0, {
        name,
        direction,
        parent,
        order: chainSequenceRef.current,
      });
      return next;
    });
    setChainFocus(name);
  };

  const removeChainBranch = (name: string) => {
    if (name === selectedName) return;
    setChainSteps((steps) => {
      const removed = new Set([name]);
      let foundDescendant = true;
      while (foundDescendant) {
        foundDescendant = false;
        steps.forEach((step) => {
          if (step.parent && removed.has(step.parent) && !removed.has(step.name)) {
            removed.add(step.name);
            foundDescendant = true;
          }
        });
      }
      const removedStep = steps.find((step) => step.name === name);
      if (selectedName && removed.has(selectedName)) {
        const preserved = new Set([selectedName]);
        let foundPreservedDescendant = true;
        while (foundPreservedDescendant) {
          foundPreservedDescendant = false;
          steps.forEach((step) => {
            if (step.parent && preserved.has(step.parent) && !preserved.has(step.name)) {
              preserved.add(step.name);
              foundPreservedDescendant = true;
            }
          });
        }
        preserved.forEach((preservedName) => removed.delete(preservedName));
      }
      if (chainFocus && removed.has(chainFocus)) {
        setChainFocus(removedStep?.parent ?? selectedName);
      }
      return steps
        .filter((step) => !removed.has(step.name))
        .map((step) => step.name === selectedName && step.parent && removed.has(step.parent)
          ? { ...step, parent: undefined }
          : step);
    });
  };

  const undoChainMember = () => {
    if (chainMembers.length <= 1) return;
    const latestStep = chainSteps.reduce<ChainStep | null>(
      (latest, step) => step.name !== selectedName && (!latest || step.order > latest.order) ? step : latest,
      null,
    );
    if (latestStep) removeChainBranch(latestStep.name);
  };

  const resetChain = () => {
    if (!selectedName) return;
    chainSequenceRef.current = 0;
    setChainSteps([{ name: selectedName, order: 0 }]);
    setChainFocus(selectedName);
  };

  const switchSelectedCharacter = () => {
    if (!chainFocus || chainFocus === selectedName) return;
    setSelectedName(chainFocus);
  };

  useEffect(() => {
    if (!selectedName || !drawerRef.current) return;
    const drawer = drawerRef.current;
    const getFocusableElements = () =>
      Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

    getFocusableElements()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedName(null);
        setTeamResults(null);
        setIsGenerating(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) return;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [selectedName]);

  const selectFirstSearchMatch = () => {
    if (!normalizedSearch) return;
    const match = characters.find((character) =>
      character.name.toLowerCase().includes(normalizedSearch),
    );
    if (match) activateGraphNode(match.name);
  };

  const togglePinnedName = (name: string) => {
    setPinnedNames((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const activateGraphNode = (name: string) => {
    if (isMultiSelect) {
      togglePinnedName(name);
      return;
    }
    openTeamBuilder(name);
  };

  const toggleMultiSelect = (enabled: boolean) => {
    setIsMultiSelect(enabled);
    setPinnedNames(new Set());
    setHoveredName(null);
  };

  const beginNodeHover = (name: string) => {
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    setHoveredName(name);
  };

  const endNodeHover = () => {
    if (hoverLeaveTimerRef.current !== null) {
      window.clearTimeout(hoverLeaveTimerRef.current);
    }
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      setHoveredName(null);
      hoverLeaveTimerRef.current = null;
    }, 90);
  };

  const renderGraphNode = (character: Character) => {
    const point = displayLayout.get(character.name) ?? layout.get(character.name)!;
    const isRoleMatch =
      roleFilter === "All heroes" ||
      character.role === roleFilter ||
      character.role === "All";
    const isSearchMatch =
      !normalizedSearch || character.name.toLowerCase().includes(normalizedSearch);
    const isConnected = highlightedNames.size === 0 || connectedNames.has(character.name);
    const isFilterDim = !isRoleMatch || !isSearchMatch;
    const isConnectionDim = !isFilterDim && !isConnected;
    const hideName = highlightedNames.size > 0 && !isConnected;
    const isActive = highlightedNames.has(character.name);
    const isRelatedPreview =
      highlightedNames.size > 0 && !isFilterDim && isConnected && !isActive;
    const isPinned = pinnedNames.has(character.name);
    const hasImage = !failedImageNames.has(character.name);
    const portraitId = `portrait-${character.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;

    return (
      <g
        className={`hero-node ${roleClass(character.role)} ${isFilterDim ? "filter-dim" : ""} ${isConnectionDim ? "connection-dim" : ""} ${isRelatedPreview ? "connection-related" : ""} ${hideName ? "name-hidden" : ""} ${isActive ? "active" : ""} ${isPinned ? "multi-selected" : ""} ${!character.released ? "unreleased" : ""}`}
        data-character={character.name}
        role="button"
        tabIndex={0}
        aria-pressed={isMultiSelect ? isPinned : undefined}
        aria-label={`${character.name}, ${character.role === "All" ? "any role" : character.role}. ${isMultiSelect ? `${isPinned ? "Remove from" : "Add to"} path selection.` : character.released ? "Select to generate optimal teams." : "Not yet released; team generation unavailable."}`}
        transform={`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`}
        onMouseEnter={() => beginNodeHover(character.name)}
        onMouseLeave={endNodeHover}
        onFocus={() => beginNodeHover(character.name)}
        onBlur={() => setHoveredName(null)}
        onClick={() => activateGraphNode(character.name)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activateGraphNode(character.name);
          }
        }}
        key={character.name}
      >
        <defs>
          <clipPath id={portraitId}>
            <circle r={nodeRadius - 2} />
          </clipPath>
        </defs>
        <circle className="node-halo" r={nodeRadius + 7} />
        <circle className="node-core" r={nodeRadius} />
        {hasImage ? (
          <image
            className="node-portrait"
            href={`characters/${characterImageFilename(character.name)}`}
            x={-nodeRadius + 2}
            y={-nodeRadius + 2}
            width={(nodeRadius - 2) * 2}
            height={(nodeRadius - 2) * 2}
            clipPath={`url(#${portraitId})`}
            preserveAspectRatio="xMidYMid slice"
            onError={() => setFailedImageNames((names) => new Set(names).add(character.name))}
          />
        ) : (
          <text className="node-initials" textAnchor="middle" dominantBaseline="central">{initials(character.name)}</text>
        )}
        <text className="node-name" y={nodeRadius + 17} textAnchor="middle">{character.name}</text>
        {!character.released && <text className="node-nr" x={nodeRadius * 0.72} y={-nodeRadius * 0.7} textAnchor="middle">NR</text>}
      </g>
    );
  };

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#network-title" aria-label="Rivals Connections map">
          <span className="brand-mark" aria-hidden="true">RC</span>
          <span>
            <strong>Rivals Connections</strong>
            <small>Team-up intelligence</small>
          </span>
        </a>
        <nav className="view-switch" aria-label="Choose data view">
          <button
            className={viewMode === "network" ? "active" : ""}
            onClick={() => setViewMode("network")}
            aria-pressed={viewMode === "network"}
          >
            Network
          </button>
          <button
            className={viewMode === "ranking" ? "active" : ""}
            onClick={() => setViewMode("ranking")}
            aria-pressed={viewMode === "ranking"}
          >
            Rankings
          </button>
        </nav>
        <label className="season-select">
          <span>Data set</span>
          <select
            value={seasonId}
            onChange={(event) => {
              closeTeamBuilder();
              setPinnedNames(new Set());
              setSeasonId(event.target.value);
            }}
          >
            {seasons.map((item) => (
              <option value={item.id} key={item.id}>{item.label}</option>
            ))}
          </select>
        </label>
      </header>

      <section className="explorer" aria-labelledby="network-title">
        <div className="explorer-head">
          <div>
            <span className="eyebrow">
              {viewMode === "network" ? "CONNECTION WEB" : `ROSTER RANKING · ${season.shortLabel}`}
            </span>
            <h2 id="network-title">
              {viewMode === "network" ? "Who powers your pick?" : "Least to most connections"}
            </h2>
          </div>
          {viewMode === "network" ? (
            isMultiSelect && pinnedNames.size > 0 ? (
              <div className="multi-focus-summary" aria-live="polite">
                <span className="multi-focus-count">{pinnedNames.size} selected</span>
                <div className="multi-focus-roster">
                  {selectionRoleOrder.map(({ role, label }) => {
                    const names = [...pinnedNames].filter(
                      (name) => characterMap.get(name)?.role === role,
                    );
                    if (names.length === 0) return null;
                    return (
                      <div className="multi-role-group" aria-label={`${label}: ${names.join(", ")}`} key={role}>
                        <small>{label}</small>
                        <div>
                          {names.map((name) => (
                            <span className="multi-focus-hero" role="img" aria-label={name} title={name} key={name}>
                              <CharacterPortrait
                                name={name}
                                className={`multi-focus-portrait ${roleClass(role)}`}
                              />
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : activeCharacter ? (
              <div className="focus-summary" aria-live="polite">
                <div className="focus-title">
                  <CharacterPortrait
                    name={activeCharacter.name}
                    className={`mini-monogram ${roleClass(activeCharacter.role)}`}
                  />
                  <span>
                    <strong>{activeCharacter.name}</strong>
                    <small>{activeCharacter.role === "All" ? "Flexible role" : activeCharacter.role}</small>
                  </span>
                </div>
                <div className="focus-summary-link">
                  <span>POWERED BY</span>
                  <strong>{activeCharacter.providers.join(" · ") || "None"}</strong>
                </div>
                <div className="focus-summary-link">
                  <span>PROVIDES TO</span>
                  <strong>{(recipients.get(activeCharacter.name) ?? []).join(" · ") || "None"}</strong>
                </div>
              </div>
            ) : (
              <div className="network-key" aria-label="Connection key">
                <span><i className="key-line incoming" /> receives team-up</span>
                <span><i className="key-line outgoing" /> provides team-up</span>
              </div>
            )
          ) : (
            <div className="chart-legend" aria-label="Chart legend">
              <span><i className="legend-swatch incoming" /> Receives</span>
              <span><i className="legend-swatch outgoing" /> Provides</span>
            </div>
          )}
        </div>

        <div className={`toolbar ${viewMode === "network" ? "" : "is-hidden"}`}>
          <label className="search-box">
            <span className="sr-only">Search heroes</span>
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && selectFirstSearchMatch()}
              placeholder="Find a hero…"
            />
            {search && <button onClick={() => setSearch("")} aria-label="Clear search">×</button>}
          </label>
          <div className="role-filters" aria-label="Filter by role">
            {roleOrder.map((role) => (
              <button
                className={roleFilter === role ? "active" : ""}
                onClick={() => setRoleFilter(role)}
                aria-pressed={roleFilter === role}
                key={role}
              >
                {role}
              </button>
            ))}
          </div>
          <div className="multi-select-tools">
            <label className={`multi-select-toggle ${isMultiSelect ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={isMultiSelect}
                onChange={(event) => toggleMultiSelect(event.target.checked)}
              />
              <span aria-hidden="true" />
              <strong>Select multiple</strong>
              {isMultiSelect && <small>{pinnedNames.size} selected</small>}
            </label>
            {isMultiSelect && pinnedNames.size > 0 && (
              <button className="clear-multi-select" onClick={() => setPinnedNames(new Set())}>
                Clear
              </button>
            )}
          </div>
          <span className="toolbar-hint">
            <i aria-hidden="true">↗</i>
            {isMultiSelect ? "Click heroes to add or remove" : "Hover to trace · click to build"}
          </span>
        </div>

        <div className={`graph-frame ${viewMode === "network" ? "" : "is-hidden"}`}>
          <div ref={graphContainerRef} className="graph-scroll" aria-label="Interactive character network">
            <svg
              className="network-svg"
              viewBox={`0 0 ${layoutSize.width} ${layoutSize.height}`}
              role="img"
              aria-label={`${season.label} Marvel Rivals team-up connection network`}
            >
              <defs>
                <marker id="arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="arrow-incoming" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="arrow-outgoing" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="arrow-both" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
              </defs>
              <g className="svg-role-guides" aria-hidden="true">
                <line x1={layoutSize.width * 0.3} y1="76" x2={layoutSize.width * 0.3} y2={layoutSize.height - 28} />
                <line x1={layoutSize.width * 0.7} y1="76" x2={layoutSize.width * 0.7} y2={layoutSize.height - 28} />
              </g>
              <g className="svg-role-labels" aria-hidden="true">
                <text className="vanguard" x={roleCenters.Vanguard.x} y="58" textAnchor="middle">VANGUARD</text>
                <text className="duelist" x={roleCenters.Duelist.x} y="58" textAnchor="middle">DUELIST</text>
                <text className="strategist" x={roleCenters.Strategist.x} y="58" textAnchor="middle">STRATEGIST</text>
              </g>
              <g className="edges">
                {edges.map((edge) => {
                  const source = displayLayout.get(edge.source) ?? layout.get(edge.source)!;
                  const target = displayLayout.get(edge.target) ?? layout.get(edge.target)!;
                  const sourceHighlighted = highlightedNames.has(edge.source);
                  const targetHighlighted = highlightedNames.has(edge.target);
                  const ports = edgePorts.get(edgeKey(edge)) ?? {
                    startAngle: Math.atan2(target.y - source.y, target.x - source.x),
                    endAngle: Math.atan2(source.y - target.y, source.x - target.x),
                  };
                  const state = isMultiSelect
                    ? hoveredName === edge.source
                      ? "outgoing"
                      : hoveredName === edge.target
                        ? "incoming"
                        : pinnedNames.has(edge.source) && pinnedNames.has(edge.target)
                          ? "both"
                          : highlightedNames.size > 0
                            ? "dim"
                            : "muted"
                    : sourceHighlighted && targetHighlighted
                      ? "both"
                      : sourceHighlighted
                        ? "outgoing"
                        : targetHighlighted
                          ? "incoming"
                          : highlightedNames.size > 0
                            ? "dim"
                            : "muted";
                  const markerState = state === "dim" ? "muted" : state;
                  return (
                    <path
                      className={`edge ${state}`}
                      d={edgePath(source, target, ports, nodeRadius)}
                      markerEnd={`url(#arrow-${markerState})`}
                      key={`${edge.source}-${edge.target}`}
                    />
                  );
                })}
              </g>
              <g className="nodes">
                {characters.map((character) => renderGraphNode(character))}
              </g>
            </svg>
          </div>

        </div>
        <section className={`connections-chart ${viewMode === "ranking" ? "" : "is-hidden"}`} aria-label="Connection rankings">
          <div
            className={`ranking-chart ${rankingHoveredName ? "has-relation-focus" : ""}`}
            aria-label="Characters ranked from least to most total connections"
          >
            {connectionRanking.map((item, index) => {
              const isHoverSource = rankingHoveredName === item.character.name;
              const isIncomingRelation = Boolean(
                rankingHoveredName &&
                characterMap.get(rankingHoveredName)?.providers.includes(item.character.name),
              );
              const isOutgoingRelation = Boolean(
                rankingHoveredName &&
                (recipients.get(rankingHoveredName) ?? []).includes(item.character.name),
              );
              const relationClass = isIncomingRelation && isOutgoingRelation
                ? "relation-both"
                : isIncomingRelation
                  ? "relation-incoming"
                  : isOutgoingRelation
                    ? "relation-outgoing"
                    : "";

              return (
                <button
                  className={`ranking-row ${isHoverSource ? "relation-source" : ""} ${relationClass}`}
                  onMouseEnter={() => setRankingHoveredName(item.character.name)}
                  onMouseLeave={() => setRankingHoveredName(null)}
                  onFocus={() => setRankingHoveredName(item.character.name)}
                  onBlur={() => setRankingHoveredName(null)}
                  onClick={() => openTeamBuilder(item.character.name)}
                  aria-label={`${item.character.name}: ${item.total} total connections, ${item.incoming} received and ${item.outgoing} provided. Select to build a team.`}
                  key={item.character.name}
                >
                  <span className="ranking-label">
                    <small>{String(index + 1).padStart(2, "0")}</small>
                    <CharacterPortrait
                      name={item.character.name}
                      className={`ranking-portrait ${roleClass(item.character.role)}`}
                    />
                    <strong>{item.character.name}</strong>
                  </span>
                  <span className="bar-track" aria-hidden="true">
                    <span
                      className="bar-segment incoming"
                      style={{ width: `${(item.incoming / maxConnectionCount) * 100}%` }}
                    />
                    <span
                      className="bar-segment outgoing"
                      style={{ width: `${(item.outgoing / maxConnectionCount) * 100}%` }}
                    />
                  </span>
                  <span className="ranking-total">
                    <strong>{item.total}</strong>
                    <small>{item.incoming}R · {item.outgoing}P</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </section>

      {selectedCharacter && (
        <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeTeamBuilder()}>
          <aside ref={drawerRef} className="team-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby="drawer-description">
            <div className="drawer-head">
              <div className="drawer-character">
                <CharacterPortrait
                  name={selectedCharacter.name}
                  className={`drawer-monogram ${roleClass(selectedCharacter.role)}`}
                />
                <div>
                  <span className="eyebrow">TEAM BUILDER · {season.shortLabel}</span>
                  <h2 id="drawer-title">Teams for {selectedCharacter.name}</h2>
                  <p id="drawer-description">
                    Powered by {selectedCharacter.providers.join(" and ") || "no listed providers"}.
                    Provides to {(recipients.get(selectedCharacter.name) ?? []).join(" and ") || "no listed heroes"}.
                  </p>
                </div>
              </div>
              <button className="drawer-close" onClick={closeTeamBuilder} aria-label="Close team builder">×</button>
            </div>

            {!selectedCharacter.released ? (
              <div className="unreleased-panel">
                <span>UNRELEASED HERO</span>
                <h3>The Hood is visible in the network, but not eligible for teams yet.</h3>
                <p>His outgoing connections remain mapped so the live roster shows the full Season 9 picture.</p>
                <button onClick={closeTeamBuilder}>Return to network</button>
              </div>
            ) : (
              <div className="drawer-body">
                <section className="chain-builder" aria-labelledby="chain-builder-title">
                  <div className="chain-builder-head">
                    <div>
                      <span className="eyebrow">WORKFLOW EDITOR · {chainMembers.length}/6 HEROES</span>
                      <h3 id="chain-builder-title">Team-up workflow</h3>
                      <p>Choose a portrait to edit from it. Incoming joins on the left; outgoing joins on the right.</p>
                    </div>
                    <div className="chain-actions">
                      <button onClick={undoChainMember} disabled={chainMembers.length <= 1}>Undo</button>
                      <button onClick={resetChain} disabled={chainMembers.length <= 1}>Start over</button>
                    </div>
                  </div>

                  {focusedChainCharacter && (
                    <div className="chain-picker">
                      <div className="chain-options incoming-options">
                        <div className="chain-option-heading">
                          <strong>Incoming</strong>
                          <span>Feeds the active step</span>
                        </div>
                        <div className="chain-option-list">
                          {chainMembers.length < 6 && incomingChainOptions.length > 0 ? incomingChainOptions.map((name) => {
                            const character = characterMap.get(name)!;
                            return (
                              <button
                                onClick={() => addChainMember(name, "incoming")}
                                aria-label={`Add ${name} as an incoming connection`}
                                title={name}
                                key={name}
                              >
                                <CharacterPortrait name={name} className={`chain-option-portrait ${roleClass(character.role)}`} />
                                <b aria-hidden="true">→</b>
                              </button>
                            );
                          }) : <span className="no-chain-options">{chainMembers.length >= 6 ? "Team filled" : "No unselected incoming options"}</span>}
                        </div>
                      </div>

                      <div className="chain-center">
                        <button
                          className="chain-switch"
                          onClick={switchSelectedCharacter}
                          disabled={focusedChainCharacter.name === selectedName}
                          aria-label={`Make ${focusedChainCharacter.name} the selected character`}
                          title={`Make ${focusedChainCharacter.name} the selected character`}
                        >
                          <b aria-hidden="true">{focusedChainCharacter.name === selectedName ? "✓" : "↔"}</b>
                          {focusedChainCharacter.name === selectedName ? "Selected hero" : "Set as selected hero"}
                        </button>
                        <span>Active step</span>
                        <CharacterPortrait
                          name={focusedChainCharacter.name}
                          className={`chain-center-portrait ${roleClass(focusedChainCharacter.role)}`}
                        />
                        <div className="embedded-workflow" aria-label="Selected team-up workflow">
                          {chainSteps.map((step, index) => {
                            const character = characterMap.get(step.name)!;
                            return (
                              <div className="embedded-step" key={`${step.name}-${index}`}>
                                <button
                                  className={`embedded-step-select ${step.name === chainFocus ? "is-focus" : ""} ${step.name === selectedName ? "is-selected" : ""}`}
                                  onClick={() => setChainFocus(step.name)}
                                  aria-pressed={step.name === chainFocus}
                                  aria-label={`Edit workflow from ${step.name}, step ${index + 1}`}
                                  title={step.name}
                                >
                                  {step.direction && <i className={step.direction} aria-hidden="true">→</i>}
                                  <CharacterPortrait name={step.name} className={`embedded-step-portrait ${roleClass(character.role)}`} />
                                  <small>{index + 1}</small>
                                </button>
                                {step.name !== selectedName && (
                                  <button
                                    className="embedded-step-remove"
                                    onClick={() => removeChainBranch(step.name)}
                                    aria-label={`Remove ${step.name} and its branch`}
                                    title={`Remove ${step.name} and its branch`}
                                  >×</button>
                                )}
                              </div>
                            );
                          })}
                          {Array.from({ length: 6 - chainMembers.length }, (_, index) => (
                            <span className="embedded-empty-step" aria-hidden="true" key={`empty-${index}`}>{chainMembers.length + index + 1}</span>
                          ))}
                        </div>
                        <div className="workflow-key" aria-hidden="true">
                          <span><i className="selected" /> Selected</span>
                          <span><i className="active" /> Active</span>
                        </div>
                      </div>

                      <div className="chain-options outgoing-options">
                        <div className="chain-option-heading">
                          <strong>Outgoing</strong>
                          <span>Continues from the active step</span>
                        </div>
                        <div className="chain-option-list">
                          {chainMembers.length < 6 && outgoingChainOptions.length > 0 ? outgoingChainOptions.map((name) => {
                            const character = characterMap.get(name)!;
                            return (
                              <button
                                onClick={() => addChainMember(name, "outgoing")}
                                aria-label={`Add ${name} as an outgoing connection`}
                                title={name}
                                key={name}
                              >
                                <b aria-hidden="true">→</b>
                                <CharacterPortrait name={name} className={`chain-option-portrait ${roleClass(character.role)}`} />
                              </button>
                            );
                          }) : <span className="no-chain-options">{chainMembers.length >= 6 ? "Team filled" : "No unselected outgoing options"}</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {isGenerating || !teamResults ? (
                  <div className="generating-panel compact" aria-live="polite">
                    <span className="loader" aria-hidden="true" />
                    <div>
                      <h3>Updating team results…</h3>
                      <p>Your workflow stays editable while the best lineups are recalculated.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="results-summary" aria-live="polite">
                      <span><strong>{teamResults.combinationsChecked.toLocaleString()}</strong> lineups checked</span>
                      <span><strong>{teamResults.balanced.length + teamResults.open.length}</strong> top results shown</span>
                    </div>
                    <TeamSection
                      eyebrow="SECTION 01 · ROLE QUEUE"
                      title="Two · Two · Two"
                      description="Exactly two Vanguards, two Duelists, and two Strategists. Deadpool fills the missing role when selected."
                      teams={teamResults.balanced}
                      selectedName={selectedCharacter.name}
                      onSelectTeam={showTeamOnNetwork}
                    />
                    <TeamSection
                      eyebrow="SECTION 02 · OPEN QUEUE"
                      title="Any role combination"
                      description="No role limits. Teams where every hero receives a team-up are ranked first."
                      teams={teamResults.open}
                      selectedName={selectedCharacter.name}
                      onSelectTeam={showTeamOnNetwork}
                    />
                    <div className="ranking-note">
                      <strong>How the ranking works</strong>
                      <p>
                        Receiving coverage comes first: each hero needs one of their listed providers on the team. Extra provider → recipient
                        links break ties, followed by complete two-provider packages. The Hood is always excluded; Deadpool appears once at most.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
