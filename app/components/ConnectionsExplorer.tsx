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
type RoleFilter = "All heroes" | Exclude<Role, "All" | "TBD">;
type ViewMode = "network" | "ranking";
type GraphSize = { width: number; height: number };

const NODE_RADIUS = 26;
const DEFAULT_GRAPH_SIZE: GraphSize = { width: 1400, height: 680 };
const roleOrder: RoleFilter[] = [
  "All heroes",
  "Vanguard",
  "Duelist",
  "Strategist",
];

function getRoleCenters({ width, height }: GraphSize): Record<Role, Point> {
  return {
    Vanguard: { x: width * 0.18, y: height * 0.53 },
    Duelist: { x: width * 0.5, y: height * 0.53 },
    Strategist: { x: width * 0.82, y: height * 0.53 },
    All: { x: width * 0.5, y: height * 0.13 },
    TBD: { x: width * 0.9, y: height * 0.88 },
  };
}

function getMinimumNodeDistance({ width, height }: GraphSize) {
  const minimum = width < 700 ? 40 : 70;
  return Math.max(minimum, Math.min(94, width / 15, height / 6.5));
}

function getNodeRadius({ width }: GraphSize) {
  return width < 700 ? 17 : NODE_RADIUS;
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

function createLayout(characters: Character[], edges: GraphEdge[], graphSize: GraphSize) {
  const { width, height } = graphSize;
  const roleCenters = getRoleCenters(graphSize);
  const minimumDistance = getMinimumNodeDistance(graphSize);
  const points = new Map<string, Point>();
  const velocities = new Map<string, Point>();
  const groups = new Map<Role, Character[]>();

  characters.forEach((character) => {
    const group = groups.get(character.role) ?? [];
    group.push(character);
    groups.set(character.role, group);
  });

  groups.forEach((group, role) => {
    group.sort((a, b) => a.name.localeCompare(b.name));
    group.forEach((character, index) => {
      const angle =
        (Math.PI * 2 * index) / Math.max(group.length, 1) +
        ((hashName(character.name) % 17) - 8) * 0.006;
      const ring = minimumDistance * 0.82 + (index % 3) * minimumDistance * 0.82;
      const center = roleCenters[role];
      points.set(character.name, {
        x: center.x + Math.cos(angle) * ring,
        y: center.y + Math.sin(angle) * ring,
      });
      velocities.set(character.name, { x: 0, y: 0 });
    });
  });

  for (let iteration = 0; iteration < 260; iteration += 1) {
    const forces = new Map(characters.map((character) => [character.name, { x: 0, y: 0 }]));

    for (let i = 0; i < characters.length; i += 1) {
      const a = characters[i];
      const pointA = points.get(a.name)!;
      for (let j = i + 1; j < characters.length; j += 1) {
        const b = characters[j];
        const pointB = points.get(b.name)!;
        let dx = pointB.x - pointA.x;
        let dy = pointB.y - pointA.y;
        let distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < 1) {
          dx = 1;
          dy = 0;
          distanceSquared = 1;
        }
        const distance = Math.sqrt(distanceSquared);
        const repulsion = 2400 / Math.max(distanceSquared, 220);
        const collision = distance < minimumDistance ? (minimumDistance - distance) * 0.13 : 0;
        const force = repulsion + collision;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        forces.get(a.name)!.x -= fx;
        forces.get(a.name)!.y -= fy;
        forces.get(b.name)!.x += fx;
        forces.get(b.name)!.y += fy;
      }
    }

    edges.forEach((edge) => {
      const source = points.get(edge.source);
      const target = points.get(edge.target);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = (distance - minimumDistance * 2.1) * 0.0025;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      forces.get(edge.source)!.x += fx;
      forces.get(edge.source)!.y += fy;
      forces.get(edge.target)!.x -= fx;
      forces.get(edge.target)!.y -= fy;
    });

    characters.forEach((character) => {
      const point = points.get(character.name)!;
      const center = roleCenters[character.role];
      const force = forces.get(character.name)!;
      force.x += (center.x - point.x) * 0.0026;
      force.y += (center.y - point.y) * 0.0026;
      const velocity = velocities.get(character.name)!;
      velocity.x = (velocity.x + force.x) * 0.78;
      velocity.y = (velocity.y + force.y) * 0.78;
      point.x = Math.min(width - 58, Math.max(58, point.x + velocity.x));
      point.y = Math.min(height - 52, Math.max(52, point.y + velocity.y));
    });
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
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < characters.length; i += 1) {
      const a = characters[i];
      const pointA = target.get(a.name)!;
      for (let j = i + 1; j < characters.length; j += 1) {
        const b = characters[j];
        const pointB = target.get(b.name)!;
        let dx = pointB.x - pointA.x;
        let dy = pointB.y - pointA.y;
        let distance = Math.sqrt(dx * dx + dy * dy);
        const collisionDistance = minimumDistance * 0.8;
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

  target.forEach((point) => {
    point.x = Math.min(graphSize.width - 58, Math.max(58, point.x));
    point.y = Math.min(graphSize.height - 52, Math.max(52, point.y));
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

function edgePath(source: Point, target: Point, curve: number, nodeRadius: number) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const unitX = dx / distance;
  const unitY = dy / distance;
  const startX = source.x + unitX * (nodeRadius + 7);
  const startY = source.y + unitY * (nodeRadius + 7);
  const endX = target.x - unitX * (nodeRadius + 12);
  const endY = target.y - unitY * (nodeRadius + 12);
  const midX = (startX + endX) / 2 - unitY * curve;
  const midY = (startY + endY) / 2 + unitX * curve;
  return `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

function TeamCard({ team, index }: { team: RankedTeam; index: number }) {
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
    <article className="team-card">
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
            <div className={`member-chip ${roleClass(displayedRole)}`} key={member.name}>
              <span className="member-monogram">{initials(member.name)}</span>
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
    </article>
  );
}

function TeamSection({
  eyebrow,
  title,
  description,
  teams,
}: {
  eyebrow: string;
  title: string;
  description: string;
  teams: RankedTeam[];
}) {
  return (
    <section className="team-section">
      <div className="section-heading">
        <span>{eyebrow}</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="team-list">
        {teams.map((team, index) => (
          <TeamCard team={team} index={index} key={team.members.map((m) => m.name).join("-")} />
        ))}
      </div>
    </section>
  );
}

export function ConnectionsExplorer() {
  const [seasonId, setSeasonId] = useState(seasons[0].id);
  const [viewMode, setViewMode] = useState<ViewMode>("network");
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const [failedImageNames, setFailedImageNames] = useState<Set<string>>(() => new Set());
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("All heroes");
  const [teamResults, setTeamResults] = useState<TeamResults | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [graphSize, setGraphSize] = useState(DEFAULT_GRAPH_SIZE);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | SVGElement | null>(null);
  const hoverLeaveTimerRef = useRef<number | null>(null);
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
  const roleCenters = useMemo(() => getRoleCenters(graphSize), [graphSize]);
  const nodeRadius = getNodeRadius(graphSize);
  const layout = useMemo(
    () => createLayout(characters, edges, graphSize),
    [characters, edges, graphSize],
  );
  const [displayLayout, setDisplayLayout] = useState(layout);
  const displayLayoutRef = useRef(layout);

  useEffect(() => {
    const startLayout = displayLayoutRef.current;
    const targetLayout = createHoverTarget(layout, characters, hoveredName, graphSize);
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
  }, [characters, graphSize, hoveredName, layout]);

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

  const activeName = hoveredName ?? selectedName;
  const activeCharacter = activeName ? characterMap.get(activeName) : undefined;
  const connectedNames = useMemo(() => {
    if (!activeName) return new Set<string>();
    const names = new Set([activeName]);
    edges.forEach((edge) => {
      if (edge.source === activeName) names.add(edge.target);
      if (edge.target === activeName) names.add(edge.source);
    });
    return names;
  }, [activeName, edges]);

  useEffect(() => {
    if (!selectedName) return;
    const selected = characterMap.get(selectedName);
    if (!selected?.released) return;
    const cacheKey = `${season.id}:${selectedName}`;
    if (cache.current.has(cacheKey)) return;
    const timer = window.setTimeout(() => {
      const result = generateOptimalTeams(characters, selectedName);
      cache.current.set(cacheKey, result);
      setTeamResults(result);
      setIsGenerating(false);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [selectedName, season.id, characters, characterMap]);

  const selectedCharacter = selectedName ? characterMap.get(selectedName) : undefined;
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
    setTeamResults(cached);
    setIsGenerating(Boolean(character?.released && !cached));
  };

  const closeTeamBuilder = () => {
    setSelectedName(null);
    setTeamResults(null);
    setIsGenerating(false);
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
    if (match) openTeamBuilder(match.name);
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
            activeCharacter ? (
              <div className="focus-summary" aria-live="polite">
                <div className="focus-title">
                  <span className={`mini-monogram ${roleClass(activeCharacter.role)}`}>{initials(activeCharacter.name)}</span>
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
          <span className="toolbar-hint"><i aria-hidden="true">↗</i> Hover to trace · click to build</span>
        </div>

        <div className={`graph-frame ${viewMode === "network" ? "" : "is-hidden"}`}>
          <div ref={graphContainerRef} className="graph-scroll" aria-label="Interactive character network">
            <svg
              className="network-svg"
              viewBox={`0 0 ${graphSize.width} ${graphSize.height}`}
              role="img"
              aria-label={`${season.label} Marvel Rivals team-up connection network`}
            >
              <defs>
                <marker id="arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="arrow-incoming" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
                <marker id="arrow-outgoing" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
              </defs>
              <g className="svg-role-labels" aria-hidden="true">
                <text className="vanguard" x={roleCenters.Vanguard.x} y="58" textAnchor="middle">VANGUARD</text>
                <text className="duelist" x={roleCenters.Duelist.x} y="58" textAnchor="middle">DUELIST</text>
                <text className="strategist" x={roleCenters.Strategist.x} y="58" textAnchor="middle">STRATEGIST</text>
              </g>
              <g className="edges">
                {edges.map((edge) => {
                  const source = displayLayout.get(edge.source) ?? layout.get(edge.source)!;
                  const target = displayLayout.get(edge.target) ?? layout.get(edge.target)!;
                  const isOutgoing = activeName === edge.source;
                  const isIncoming = activeName === edge.target;
                  const bend = 18 + (hashName(`${edge.source}:${edge.target}`) % 24);
                  const curve = edge.source < edge.target ? bend : -bend;
                  const state = isOutgoing ? "outgoing" : isIncoming ? "incoming" : activeName ? "dim" : "muted";
                  return (
                    <path
                      className={`edge ${state}`}
                      d={edgePath(source, target, curve, nodeRadius)}
                      markerEnd={`url(#arrow-${isOutgoing ? "outgoing" : isIncoming ? "incoming" : "muted"})`}
                      key={`${edge.source}-${edge.target}`}
                    />
                  );
                })}
              </g>
              <g className="nodes">
                {characters.map((character) => {
                  const point = displayLayout.get(character.name) ?? layout.get(character.name)!;
                  const isRoleMatch =
                    roleFilter === "All heroes" ||
                    character.role === roleFilter ||
                    character.role === "All";
                  const isSearchMatch =
                    !normalizedSearch || character.name.toLowerCase().includes(normalizedSearch);
                  const isConnected = !activeName || connectedNames.has(character.name);
                  const isFilterDim = !isRoleMatch || !isSearchMatch;
                  const isConnectionDim = !isFilterDim && !isConnected;
                  const hideName = Boolean(activeName) && !isConnected;
                  const isActive = activeName === character.name;
                  const hasImage = !failedImageNames.has(character.name);
                  const portraitId = `portrait-${character.name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`;
                  return (
                    <g
                      className={`hero-node ${roleClass(character.role)} ${isFilterDim ? "filter-dim" : ""} ${isConnectionDim ? "connection-dim" : ""} ${hideName ? "name-hidden" : ""} ${isActive ? "active" : ""} ${!character.released ? "unreleased" : ""}`}
                      data-character={character.name}
                      role="button"
                      tabIndex={0}
                      aria-label={`${character.name}, ${character.role === "All" ? "any role" : character.role}. ${character.released ? "Select to generate optimal teams." : "Not yet released; team generation unavailable."}`}
                      transform={`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`}
                      onMouseEnter={() => beginNodeHover(character.name)}
                      onMouseLeave={endNodeHover}
                      onFocus={() => beginNodeHover(character.name)}
                      onBlur={() => setHoveredName(null)}
                      onClick={() => openTeamBuilder(character.name)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTeamBuilder(character.name);
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
                })}
              </g>
            </svg>
          </div>

        </div>
        <section className={`connections-chart ${viewMode === "ranking" ? "" : "is-hidden"}`} aria-label="Connection rankings">
          <div className="ranking-chart" aria-label="Characters ranked from least to most total connections">
            {connectionRanking.map((item, index) => (
              <button
                className="ranking-row"
                onClick={() => openTeamBuilder(item.character.name)}
                aria-label={`${item.character.name}: ${item.total} total connections, ${item.incoming} received and ${item.outgoing} provided. Select to build a team.`}
                key={item.character.name}
              >
                <span className="ranking-label">
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <i className={`ranking-role-dot ${roleClass(item.character.role)}`} aria-hidden="true" />
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
            ))}
          </div>
        </section>
      </section>

      {selectedCharacter && (
        <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeTeamBuilder()}>
          <aside ref={drawerRef} className="team-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby="drawer-description">
            <div className="drawer-head">
              <div className="drawer-character">
                <span className={`drawer-monogram ${roleClass(selectedCharacter.role)}`}>{initials(selectedCharacter.name)}</span>
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
            ) : isGenerating || !teamResults ? (
              <div className="generating-panel" aria-live="polite">
                <span className="loader" aria-hidden="true" />
                <h3>Testing every eligible lineup…</h3>
                <p>Scoring active links, complete packages, and role balance.</p>
              </div>
            ) : (
              <div className="drawer-body">
                <div className="results-summary">
                  <span><strong>{teamResults.combinationsChecked.toLocaleString()}</strong> lineups checked</span>
                  <span><strong>{teamResults.balanced.length + teamResults.open.length}</strong> top results shown</span>
                </div>
                <TeamSection
                  eyebrow="SECTION 01 · ROLE QUEUE"
                  title="Two · Two · Two"
                  description="Exactly two Vanguards, two Duelists, and two Strategists. Deadpool fills the missing role when selected."
                  teams={teamResults.balanced}
                />
                <TeamSection
                  eyebrow="SECTION 02 · OPEN QUEUE"
                  title="Any role combination"
                  description="No role limits. Teams where every hero receives a team-up are ranked first."
                  teams={teamResults.open}
                />
                <div className="ranking-note">
                  <strong>How the ranking works</strong>
                  <p>
                    Receiving coverage comes first: each hero needs one of their listed providers on the team. Extra provider → recipient
                    links break ties, followed by complete two-provider packages. The Hood is always excluded; Deadpool appears once at most.
                  </p>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
