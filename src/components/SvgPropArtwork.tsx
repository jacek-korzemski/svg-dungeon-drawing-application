import React from 'react';
import { BuildingStyle, DoorType, ExteriorWallStyle, StairType, SvgPropId, WallStyle } from '../types/dungeon';

interface PropArtworkProps {
  propId: SvgPropId;
  width: number;
  height: number;
  inkColor?: string;
  fillColor?: string;
}

export const SvgPropArtwork: React.FC<PropArtworkProps> = ({
  propId,
  width,
  height,
  inkColor = '#18181B',
  fillColor = '#E7DFD1',
}) => {
  const hw = width / 2;
  const hh = height / 2;

  switch (propId) {
    case 'barrel':
      return (
        <g>
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.85} fill="#C89D6C" stroke={inkColor} strokeWidth={1.8} />
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.65} fill="none" stroke={inkColor} strokeWidth={1} strokeDasharray="3 2" />
          <line x1={-hw * 0.55} y1={-hh * 0.5} x2={-hw * 0.55} y2={hh * 0.5} stroke={inkColor} strokeWidth={0.9} />
          <line x1={0} y1={-hh * 0.78} x2={0} y2={hh * 0.78} stroke={inkColor} strokeWidth={0.9} />
          <line x1={hw * 0.55} y1={-hh * 0.5} x2={hw * 0.55} y2={hh * 0.5} stroke={inkColor} strokeWidth={0.9} />
          <circle cx={hw * 0.28} cy={-hh * 0.25} r={1.8} fill={inkColor} />
        </g>
      );

    case 'crate':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} fill="#D4B082" stroke={inkColor} strokeWidth={1.8} />
          <rect x={-hw + 5} y={-hh + 5} width={width - 10} height={height - 10} fill="none" stroke={inkColor} strokeWidth={1} />
          <line x1={-hw + 5} y1={-hh + 5} x2={hw - 5} y2={hh - 5} stroke={inkColor} strokeWidth={1.2} />
        </g>
      );

    case 'table':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} rx={2} fill="#C69C6D" stroke={inkColor} strokeWidth={1.8} />
          <line x1={-hw + 2} y1={-hh * 0.3} x2={hw - 2} y2={-hh * 0.3} stroke={inkColor} strokeWidth={0.8} opacity={0.6} />
          <line x1={-hw + 2} y1={hh * 0.3} x2={hw - 2} y2={hh * 0.3} stroke={inkColor} strokeWidth={0.8} opacity={0.6} />
          {/* Bench / chairs */}
          <rect x={-hw * 0.65} y={-hh - 3} width={width * 0.3} height={3} fill={fillColor} stroke={inkColor} strokeWidth={1} />
          <rect x={hw * 0.35} y={-hh - 3} width={width * 0.3} height={3} fill={fillColor} stroke={inkColor} strokeWidth={1} />
          <rect x={-hw * 0.65} y={hh} width={width * 0.3} height={3} fill={fillColor} stroke={inkColor} strokeWidth={1} />
          <rect x={hw * 0.35} y={hh} width={width * 0.3} height={3} fill={fillColor} stroke={inkColor} strokeWidth={1} />
        </g>
      );

    case 'throne':
      return (
        <g>
          {/* Dais step */}
          <rect x={-hw} y={-hh} width={width} height={height} fill={fillColor} stroke={inkColor} strokeWidth={1.2} />
          {/* Chair back & armrests */}
          <rect x={-hw * 0.65} y={-hh * 0.7} width={width * 0.65} height={height * 0.7} fill="#B45309" stroke={inkColor} strokeWidth={1.8} />
          <rect x={-hw * 0.65} y={-hh * 0.7} width={width * 0.65} height={height * 0.22} fill="#F59E0B" stroke={inkColor} strokeWidth={1.4} />
          <rect x={-hw * 0.75} y={-hh * 0.55} width={width * 0.16} height={height * 0.65} fill="#92400E" stroke={inkColor} strokeWidth={1.2} />
          <rect x={hw * 0.43} y={-hh * 0.55} width={width * 0.16} height={height * 0.65} fill="#92400E" stroke={inkColor} strokeWidth={1.2} />
        </g>
      );

    case 'chest':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} fill="#9A5B2C" stroke={inkColor} strokeWidth={1.8} />
          <line x1={-hw + 2} y1={0} x2={hw - 2} y2={0} stroke={inkColor} strokeWidth={1} />
          <line x1={-hw * 0.55} y1={-hh + 2} x2={-hw * 0.55} y2={hh - 2} stroke={inkColor} strokeWidth={1.6} />
          <line x1={hw * 0.55} y1={-hh + 2} x2={hw * 0.55} y2={hh - 2} stroke={inkColor} strokeWidth={1.6} />
          <rect x={-3} y={-2.5} width={6} height={5} fill="#FBBF24" stroke={inkColor} strokeWidth={1.2} />
        </g>
      );

    case 'bed':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} fill="#CBD5E1" stroke={inkColor} strokeWidth={1.8} />
          {/* Headboard */}
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={5} fill="#854D27" stroke={inkColor} strokeWidth={1.4} />
          {/* Pillow */}
          <rect x={-hw + 6} y={-hh + 9} width={width - 12} height={8} rx={2} fill="#FFFFFF" stroke={inkColor} strokeWidth={1.1} />
          {/* Folded blanket */}
          <line x1={-hw + 2} y1={-hh + 21} x2={hw - 2} y2={-hh + 21} stroke={inkColor} strokeWidth={1.3} />
          <path d={`M ${-hw + 2} ${-hh + 21} L ${hw * 0.3} ${-hh + 27} L ${hw - 2} ${-hh + 21}`} fill="none" stroke={inkColor} strokeWidth={1} />
        </g>
      );

    case 'bookshelf':
      return (
        <g>
          <rect x={-hw + 1} y={-hh + 2} width={width - 2} height={height - 4} fill="#78350F" stroke={inkColor} strokeWidth={1.8} />
          {/* Book spines */}
          {[-0.7, -0.45, -0.2, 0.05, 0.3, 0.55, 0.75].map((pos, idx) => (
            <line
              key={idx}
              x1={hw * pos}
              y1={-hh + 3}
              x2={hw * pos}
              y2={hh - 3}
              stroke={idx % 2 === 0 ? '#FDE68A' : '#FCA5A5'}
              strokeWidth={1.4}
            />
          ))}
        </g>
      );

    case 'brazier':
      return (
        <g>
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.85} fill="#475569" stroke={inkColor} strokeWidth={1.8} />
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.56} fill="#EA580C" stroke={inkColor} strokeWidth={1.2} />
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.28} fill="#FEF08A" />
        </g>
      );

    case 'altar':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} fill="#D6D3D1" stroke={inkColor} strokeWidth={2} />
          <rect x={-hw + 6} y={-hh + 6} width={width - 12} height={height - 12} fill="none" stroke={inkColor} strokeWidth={1.1} />
          {/* Sacred star/cross */}
          <line x1={-6} y1={0} x2={6} y2={0} stroke={inkColor} strokeWidth={1.5} />
          <line x1={0} y1={-6} x2={0} y2={6} stroke={inkColor} strokeWidth={1.5} />
          <circle cx={0} cy={0} r={3.5} fill="none" stroke={inkColor} strokeWidth={1.1} />
        </g>
      );

    case 'sarcophagus':
      return (
        <g>
          <polygon
            points={`${-hw * 0.6},${-hh + 2} ${hw * 0.6},${-hh + 2} ${hw - 2},${-hh * 0.35} ${hw * 0.72},${hh - 2} ${-hw * 0.72},${hh - 2} ${-hw + 2},${-hh * 0.35}`}
            fill="#CBD5E1"
            stroke={inkColor}
            strokeWidth={1.8}
          />
          <line x1={0} y1={-hh + 5} x2={0} y2={hh - 5} stroke={inkColor} strokeWidth={1.2} />
          <line x1={-hw * 0.45} y1={-hh * 0.25} x2={hw * 0.45} y2={-hh * 0.25} stroke={inkColor} strokeWidth={1.2} />
        </g>
      );

    case 'pillar':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} fill={fillColor} stroke={inkColor} strokeWidth={1.2} />
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.72} fill="#94A3B8" stroke={inkColor} strokeWidth={2} />
          <path d={`M ${-hw * 0.35} ${-hh * 0.35} L ${hw * 0.35} ${hh * 0.35}`} stroke={inkColor} strokeWidth={1} />
        </g>
      );

    case 'statue':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 2} width={width - 4} height={height - 4} fill="#CBD5E1" stroke={inkColor} strokeWidth={1.6} />
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.52} fill="#94A3B8" stroke={inkColor} strokeWidth={1.5} />
          <polygon points={`0,${-hh * 0.75} ${hw * 0.28},0 0,${hh * 0.75} ${-hw * 0.28},0`} fill={fillColor} stroke={inkColor} strokeWidth={1.2} />
        </g>
      );

    case 'weapon_rack':
      return (
        <g>
          <rect x={-hw + 2} y={-hh + 3} width={width - 4} height={height - 6} fill="#92400E" stroke={inkColor} strokeWidth={1.6} />
          {[-0.55, -0.18, 0.18, 0.55].map((p, i) => (
            <g key={i}>
              <line x1={hw * p} y1={-hh - 1} x2={hw * p} y2={hh + 1} stroke="#E2E8F0" strokeWidth={2} />
              <line x1={hw * p} y1={-hh - 1} x2={hw * p} y2={hh + 1} stroke={inkColor} strokeWidth={0.9} />
            </g>
          ))}
        </g>
      );

    case 'boulder':
      return (
        <g>
          <polygon
            points={`${-hw * 0.75},${-hh * 0.3} ${-hw * 0.25},${-hh * 0.85} ${hw * 0.65},${-hh * 0.6} ${hw * 0.85},${hh * 0.2} ${hw * 0.25},${hh * 0.82} ${-hw * 0.65},${hh * 0.65}`}
            fill="#94A3B8"
            stroke={inkColor}
            strokeWidth={1.8}
          />
          <polyline
            points={`${-hw * 0.2},${-hh * 0.7} ${hw * 0.1},${-hh * 0.1} ${hw * 0.6},${hh * 0.15}`}
            fill="none"
            stroke={inkColor}
            strokeWidth={1.1}
          />
        </g>
      );

    case 'campfire':
      return (
        <g>
          {/* Logs */}
          <line x1={-hw * 0.75} y1={-hh * 0.45} x2={hw * 0.75} y2={hh * 0.45} stroke="#78350F" strokeWidth={4} strokeLinecap="round" />
          <line x1={-hw * 0.75} y1={hh * 0.45} x2={hw * 0.75} y2={-hh * 0.45} stroke="#78350F" strokeWidth={4} strokeLinecap="round" />
          <line x1={-hw * 0.75} y1={-hh * 0.45} x2={hw * 0.75} y2={hh * 0.45} stroke={inkColor} strokeWidth={1.2} />
          <line x1={-hw * 0.75} y1={hh * 0.45} x2={hw * 0.75} y2={-hh * 0.45} stroke={inkColor} strokeWidth={1.2} />
          {/* Flame */}
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.48} fill="#F97316" stroke={inkColor} strokeWidth={1.2} />
          <circle cx={0} cy={0} r={Math.min(hw, hh) * 0.24} fill="#FEF08A" />
        </g>
      );
  }
};

interface DoorArtworkProps {
  type: DoorType;
  widthPx: number;
  inkColor?: string;
  floorColor?: string;
  flipped?: boolean;
}

export const SvgDoorArtwork: React.FC<DoorArtworkProps> = ({
  type,
  widthPx,
  inkColor = '#141618',
  floorColor = '#F9F7F1',
  flipped = false,
}) => {
  const hw = widthPx / 2;
  const thick = 8;

  if (type === 'standard') {
    return (
      <g transform={flipped ? 'scale(1, -1)' : undefined}>
        {/* Wall cutout clearing */}
        <rect x={-hw + 2} y={-thick / 2} width={widthPx - 4} height={thick} fill={floorColor} />
        {/* Door slab */}
        <rect
          x={-hw + 3}
          y={-thick / 2 + 1}
          width={widthPx - 6}
          height={thick - 2}
          fill={floorColor}
          stroke={inkColor}
          strokeWidth={2}
        />
        {/* Subtle swing arc */}
        <path
          d={`M ${-hw + 3} ${thick / 2} A ${widthPx - 6} ${widthPx - 6} 0 0 0 ${hw - 3} ${thick / 2 + (widthPx - 6) * 0.55}`}
          fill="none"
          stroke={inkColor}
          strokeWidth={1}
          strokeDasharray="2.5 2.5"
          opacity={0.65}
        />
      </g>
    );
  }

  if (type === 'double') {
    return (
      <g>
        <rect x={-hw + 2} y={-thick / 2} width={widthPx - 4} height={thick} fill={floorColor} />
        <rect
          x={-hw + 3}
          y={-thick / 2 + 1}
          width={hw - 3}
          height={thick - 2}
          fill={floorColor}
          stroke={inkColor}
          strokeWidth={2}
        />
        <rect
          x={0}
          y={-thick / 2 + 1}
          width={hw - 3}
          height={thick - 2}
          fill={floorColor}
          stroke={inkColor}
          strokeWidth={2}
        />
      </g>
    );
  }

  if (type === 'secret') {
    return (
      <g>
        <rect
          x={-hw + 4}
          y={-thick / 2}
          width={widthPx - 8}
          height={thick}
          fill={floorColor}
          stroke={inkColor}
          strokeWidth={1.6}
          strokeDasharray="3 2"
        />
        <circle cx={0} cy={-11} r={7} fill={floorColor} stroke={inkColor} strokeWidth={1.4} />
        <text
          x={0}
          y={-7.5}
          textAnchor="middle"
          fontSize="10"
          fontWeight="700"
          fontFamily="JetBrains Mono, monospace"
          fill={inkColor}
        >
          S
        </text>
      </g>
    );
  }

  if (type === 'portcullis') {
    const spikes = [-0.65, -0.32, 0, 0.32, 0.65];
    return (
      <g>
        <rect x={-hw + 2} y={-thick / 2} width={widthPx - 4} height={thick} fill={floorColor} />
        <line x1={-hw + 3} y1={0} x2={hw - 3} y2={0} stroke={inkColor} strokeWidth={2} />
        {spikes.map((s, idx) => (
          <circle
            key={idx}
            cx={hw * s}
            cy={0}
            r={2.5}
            fill={inkColor}
          />
        ))}
      </g>
    );
  }

  if (type === 'gatehouse') {
    const openingH = Math.max(14, Math.min(22, widthPx * 0.3));
    const towerW = Math.max(8, hw * 0.3);
    const towerH = openingH + 14;
    return (
      <g>
        <rect
          x={-hw + towerW * 0.15}
          y={-openingH / 2}
          width={widthPx - towerW * 0.3}
          height={openingH}
          fill="#3f3f46"
          stroke={inkColor}
          strokeWidth={1.5}
        />
        <rect x={-hw} y={-towerH / 2} width={towerW} height={towerH} fill="#d6d3d1" stroke={inkColor} strokeWidth={1.6} />
        <rect x={hw - towerW} y={-towerH / 2} width={towerW} height={towerH} fill="#d6d3d1" stroke={inkColor} strokeWidth={1.6} />
        <line x1={-hw + towerW} y1={-openingH * 0.15} x2={hw - towerW} y2={-openingH * 0.15} stroke={inkColor} strokeWidth={1.5} />
        <line x1={-hw + towerW} y1={openingH * 0.15} x2={hw - towerW} y2={openingH * 0.15} stroke={inkColor} strokeWidth={1.5} />
        <rect x={-hw + 1} y={-towerH / 2 - 3} width={towerW * 0.38} height={3} fill={inkColor} />
        <rect x={-hw + towerW * 0.58} y={-towerH / 2 - 3} width={towerW * 0.38} height={3} fill={inkColor} />
        <rect x={hw - towerW + 1} y={-towerH / 2 - 3} width={towerW * 0.38} height={3} fill={inkColor} />
        <rect x={hw - towerW * 0.42} y={-towerH / 2 - 3} width={towerW * 0.38} height={3} fill={inkColor} />
      </g>
    );
  }

  if (type === 'wood_gate') {
    const gateH = Math.max(14, Math.min(20, widthPx * 0.34));
    return (
      <g>
        <rect x={-hw} y={-gateH / 2 - 1} width={4.5} height={gateH + 2} fill="#6b3f1f" stroke={inkColor} strokeWidth={1.2} />
        <rect x={hw - 4.5} y={-gateH / 2 - 1} width={4.5} height={gateH + 2} fill="#6b3f1f" stroke={inkColor} strokeWidth={1.2} />
        <rect x={-hw + 4.5} y={-gateH / 2} width={widthPx - 9} height={gateH} fill="#d2b48c" stroke={inkColor} strokeWidth={1.5} />
        <line x1={0} y1={-gateH / 2} x2={0} y2={gateH / 2} stroke={inkColor} strokeWidth={1.3} />
        <line x1={-hw + 7} y1={-gateH * 0.32} x2={-2} y2={gateH * 0.32} stroke={inkColor} strokeWidth={1.1} />
        <line x1={2} y1={-gateH * 0.32} x2={hw - 7} y2={gateH * 0.32} stroke={inkColor} strokeWidth={1.1} />
      </g>
    );
  }

  if (type === 'bridge_stone') {
    const deckH = Math.max(14, widthPx * 0.36);
    const halfDeck = deckH / 2;
    return (
      <g>
        <path
          d={`M ${-hw} ${-halfDeck} L ${hw} ${-halfDeck} L ${hw} ${halfDeck * 0.35} Q 0 ${halfDeck + 8} ${-hw} ${halfDeck * 0.35} Z`}
          fill="#e7e5e4"
          stroke={inkColor}
          strokeWidth={1.6}
        />
        <path
          d={`M ${-hw * 0.35} ${halfDeck * 0.35} Q 0 ${halfDeck + 4} ${hw * 0.35} ${halfDeck * 0.35}`}
          fill={floorColor}
          stroke={inkColor}
          strokeWidth={1.2}
        />
        <line x1={-hw} y1={-halfDeck} x2={hw} y2={-halfDeck} stroke={inkColor} strokeWidth={1.6} />
        <line x1={-hw} y1={-halfDeck * 0.35} x2={hw} y2={-halfDeck * 0.35} stroke={inkColor} strokeWidth={1} />
      </g>
    );
  }

  if (type === 'bridge_wood') {
    const deckH = Math.max(12, widthPx * 0.32);
    const plankCount = 5;
    return (
      <g>
        <rect x={-hw} y={-deckH / 2} width={widthPx} height={deckH} fill="#c4a574" stroke={inkColor} strokeWidth={1.5} />
        <line x1={-hw} y1={-deckH / 2} x2={hw} y2={-deckH / 2} stroke="#6b3f1f" strokeWidth={2.4} />
        <line x1={-hw} y1={deckH / 2} x2={hw} y2={deckH / 2} stroke="#6b3f1f" strokeWidth={2.4} />
        {Array.from({ length: plankCount }, (_, index) => {
          const x = -hw + ((index + 1) * widthPx) / (plankCount + 1);
          return <line key={index} x1={x} y1={-deckH / 2 + 2} x2={x} y2={deckH / 2 - 2} stroke={inkColor} strokeWidth={1} />;
        })}
      </g>
    );
  }

  // archway
  return (
    <g>
      <rect x={-hw + 2} y={-thick / 2 - 1} width={widthPx - 4} height={thick + 2} fill={floorColor} />
      <rect x={-hw} y={-thick / 2 - 2} width={4} height={thick + 4} fill={inkColor} />
      <rect x={hw - 4} y={-thick / 2 - 2} width={4} height={thick + 4} fill={inkColor} />
    </g>
  );
};

interface StairArtworkProps {
  type: StairType;
  widthPx: number;
  lengthPx: number;
  inkColor?: string;
  floorColor?: string;
}

export const SvgStairArtwork: React.FC<StairArtworkProps> = ({
  type,
  widthPx,
  lengthPx,
  inkColor = '#141618',
  floorColor = '#F9F7F1',
}) => {
  const hw = widthPx / 2;
  const hl = lengthPx / 2;

  if (type === 'spiral') {
    const radius = Math.min(hw, hl);
    const numSteps = 12;
    const steps = Array.from({ length: numSteps }, (_, i) => (i * Math.PI * 2) / numSteps);
    return (
      <g>
        <circle cx={0} cy={0} r={radius} fill={floorColor} stroke={inkColor} strokeWidth={2} />
        {steps.map((ang, i) => (
          <line
            key={i}
            x1={Math.cos(ang) * (radius * 0.24)}
            y1={Math.sin(ang) * (radius * 0.24)}
            x2={Math.cos(ang) * radius}
            y2={Math.sin(ang) * radius}
            stroke={inkColor}
            strokeWidth={1.3}
          />
        ))}
        {/* Curved directional arrow */}
        <path
          d={`M ${radius * 0.55} 0 A ${radius * 0.55} ${radius * 0.55} 0 1 1 0 ${-radius * 0.55}`}
          fill="none"
          stroke={inkColor}
          strokeWidth={1.6}
        />
        <polygon
          points={`0,${-radius * 0.55 - 3} 5,${-radius * 0.55} 0,${-radius * 0.55 + 3}`}
          fill={inkColor}
        />
        <circle cx={0} cy={0} r={radius * 0.24} fill={inkColor} />
      </g>
    );
  }

  // Straight or Wide tapered Jinkline stairs
  const stepCount = Math.max(4, Math.round(lengthPx / 8));
  const rungs = Array.from({ length: stepCount + 1 }, (_, i) => i / stepCount);

  return (
    <g>
      {/* Side stringers tapering slightly toward the top (ascent) */}
      <polygon
        points={`${-hw},${hl} ${hw},${hl} ${hw * 0.72},${-hl} ${-hw * 0.72},${-hl}`}
        fill={floorColor}
        stroke={inkColor}
        strokeWidth={1.8}
      />
      {rungs.map((t, idx) => {
        const y = hl - t * lengthPx;
        const halfWidthAtT = hw * (1 - 0.28 * t);
        return (
          <line
            key={idx}
            x1={-halfWidthAtT}
            y1={y}
            x2={halfWidthAtT}
            y2={y}
            stroke={inkColor}
            strokeWidth={1.4}
          />
        );
      })}
      {/* Center ascent arrow */}
      <line x1={0} y1={hl * 0.72} x2={0} y2={-hl * 0.65} stroke={inkColor} strokeWidth={1.5} />
      <polyline
        points={`-4,${-hl * 0.45} 0,${-hl * 0.68} 4,${-hl * 0.45}`}
        fill="none"
        stroke={inkColor}
        strokeWidth={1.5}
      />
    </g>
  );
};

export const WallStylePreviewSvg: React.FC<{ style: WallStyle }> = ({ style }) => {
  return (
    <svg viewBox="0 0 64 24" className="w-16 h-6 overflow-visible">
      <rect x="2" y="2" width="60" height="20" fill="#F9F7F1" rx="2" />
      {style === 'straight' && (
        <path d="M 8 18 L 8 6 L 56 6 L 56 18" fill="none" stroke="#141618" strokeWidth="3" strokeLinejoin="miter" />
      )}
      {style === 'rock' && (
        <path
          d="M 8 18 L 6 13 L 9 9 L 8 6 L 16 4 L 24 7 L 33 4 L 42 7 L 50 5 L 56 6 L 58 12 L 55 18"
          fill="none"
          stroke="#141618"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
      )}
      {style === 'brick' && (
        <g>
          <path d="M 8 18 L 8 6 L 56 6 L 56 18" fill="none" stroke="#141618" strokeWidth="5.5" />
          <path d="M 8 18 L 8 6 L 56 6 L 56 18" fill="none" stroke="#E5E0D5" strokeWidth="3.2" />
          <path d="M 16 3.5 V 8.5 M 26 3.5 V 8.5 M 36 3.5 V 8.5 M 46 3.5 V 8.5" stroke="#141618" strokeWidth="1.2" />
        </g>
      )}
      {style === 'double' && (
        <g>
          <path d="M 8 18 L 8 6 L 56 6 L 56 18" fill="none" stroke="#141618" strokeWidth="6" />
          <path d="M 8 18 L 8 6 L 56 6 L 56 18" fill="none" stroke="#64748B" strokeWidth="2.5" />
        </g>
      )}
      {style === 'ruins' && (
        <g>
          <path
            d="M 8 18 L 8 6 L 22 6 M 30 6 L 44 6 M 51 6 L 56 6 L 56 14"
            fill="none"
            stroke="#141618"
            strokeWidth="2.8"
          />
          <rect x="24" y="4" width="3" height="3" fill="#141618" />
          <rect x="46" y="7" width="3.5" height="2.5" fill="#141618" />
        </g>
      )}
    </svg>
  );
};

export const BuildingStylePreviewSvg: React.FC<{ style: BuildingStyle }> = ({ style }) => {
  return (
    <svg viewBox="0 0 64 28" className="w-16 h-7 overflow-visible">
      <rect x="1" y="1" width="62" height="26" fill="#F4EFE4" rx="2" />
      {(style === 'roof_tile' || style === 'roof_thatch' || style === 'roof_slate') && (
        <g>
          <rect
            x="8"
            y="6"
            width="48"
            height="16"
            fill={style === 'roof_slate' ? '#4b5563' : style === 'roof_thatch' ? '#d6b25e' : '#c2410c'}
            stroke="#141618"
            strokeWidth="1.3"
          />
          <path d="M 8 6 L 18 14 L 8 22" fill={style === 'roof_slate' ? '#1f2937' : '#000'} fillOpacity="0.22" />
          <path d="M 18 14 L 46 14 L 56 22 L 8 22 Z" fill="#141618" fillOpacity="0.22" />
          <path d="M 18 14 H 46 M 8 6 L 18 14 L 8 22 M 56 6 L 46 14 L 56 22" fill="none" stroke="#141618" strokeWidth="1.2" />
        </g>
      )}
      {style === 'castle_wall' && (
        <g>
          <rect x="10" y="10" width="44" height="12" fill="#d6d3d1" stroke="#141618" strokeWidth="3" />
          <path d="M 12 10 V 6 H 16 V 10 M 22 10 V 6 H 26 V 10 M 32 10 V 6 H 36 V 10 M 42 10 V 6 H 46 V 10" fill="#d6d3d1" stroke="#141618" strokeWidth="1.1" />
          <circle cx="10" cy="14" r="3.2" fill="#e7e5e4" stroke="#141618" />
          <circle cx="54" cy="14" r="3.2" fill="#e7e5e4" stroke="#141618" />
        </g>
      )}
      {style === 'palisade' &&
        [10, 16, 22, 28, 34, 40, 46, 52].map((x) => (
          <circle key={x} cx={x} cy={14} r={3.1} fill="#a56b3c" stroke="#141618" strokeWidth="1" />
        ))}
      {style === 'ruined_building' && (
        <g>
          <path d="M 10 20 V 8 H 24 M 32 8 H 46 M 52 8 H 54 V 16" fill="none" stroke="#141618" strokeWidth="2" />
          <rect x="26" y="16" width="4" height="3" fill="#141618" />
          <rect x="47" y="18" width="5" height="3" fill="#a8a29e" stroke="#141618" strokeWidth="0.6" />
        </g>
      )}
    </svg>
  );
};

export const ExteriorWallPreviewSvg: React.FC<{ style: ExteriorWallStyle }> = ({ style }) => {
  return (
    <svg viewBox="0 0 64 24" className="w-16 h-6 overflow-visible">
      <rect x="1" y="1" width="62" height="22" fill="#F4EFE4" rx="2" />
      {style === 'castle_crenellated' && (
        <g>
          <path d="M 6 16 H 58" stroke="#141618" strokeWidth="5" />
          <path d="M 6 16 H 58" stroke="#d6d3d1" strokeWidth="2.4" />
          <path d="M 12 13.5 V 9 H 16 V 13.5 M 24 13.5 V 9 H 28 V 13.5 M 36 13.5 V 9 H 40 V 13.5 M 48 13.5 V 9 H 52 V 13.5" fill="#e7e5e4" stroke="#141618" strokeWidth="0.9" />
        </g>
      )}
      {style === 'palisade_logs' &&
        [8, 16, 24, 32, 40, 48, 56].map((x) => (
          <circle key={x} cx={x} cy={12} r={3} fill="#a56b3c" stroke="#141618" strokeWidth="0.9" />
        ))}
      {style === 'stone_wall' && (
        <g>
          <path d="M 6 12 H 58" stroke="#141618" strokeWidth="6" />
          <path d="M 6 12 H 58" stroke="#d6d3d1" strokeWidth="3" />
        </g>
      )}
      {style === 'wood_fence' && (
        <g>
          <path d="M 6 8 H 58 M 6 16 H 58" stroke="#6b3f1f" strokeWidth="1.4" />
          {[10, 22, 34, 46, 56].map((x) => (
            <rect key={x} x={x - 1.4} y={5} width={2.8} height={14} fill="#c4a574" stroke="#141618" strokeWidth="0.7" />
          ))}
        </g>
      )}
      {style === 'hedge' && (
        <path
          d="M 4 13 Q 10 7 16 13 T 28 13 T 40 13 T 52 13 T 60 12"
          fill="none"
          stroke="#2f6b3a"
          strokeWidth="6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
};
